import Cocoa
import Foundation

enum ConnectionStatus {
    case disconnected
    case connected
    case playing
}

class NodeProcessManager {
    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var logHandler: (String) -> Void
    internal var statusHandler: (ConnectionStatus) -> Void
    private var notificationHandler: (String, String) -> Void
    private(set) var isPlaying = false
    private var restartCount = 0
    private var maxRestarts = 5
    private var isShuttingDown = false
    private(set) var nowPlaying: String?
    var nowPlayingHandler: ((String?) -> Void)?
    private var isPaused = false
    private var stdoutBuffer = ""

    init(logHandler: @escaping (String) -> Void, statusHandler: @escaping (ConnectionStatus) -> Void, notificationHandler: @escaping (String, String) -> Void, nowPlayingHandler: ((String?) -> Void)? = nil) {
        self.logHandler = logHandler
        self.statusHandler = statusHandler
        self.notificationHandler = notificationHandler
        self.nowPlayingHandler = nowPlayingHandler
    }

    func start() {
        isShuttingDown = false
        let appSupport = applicationSupportDir()
        let bundleResources = Bundle.main.resourcePath ?? ""
        let shimPath = appSupport + "/shim.js"
        let nodeModulesPath = bundleResources + "/node_modules"

        setupApplicationSupport()

        guard FileManager.default.fileExists(atPath: shimPath) else {
            logHandler("ERROR: shim.js not found at \(shimPath)")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: findNodePath())
        process.arguments = [shimPath]
        process.currentDirectoryURL = URL(fileURLWithPath: appSupport)
        var env = ProcessInfo.processInfo.environment
        env["NODE_PATH"] = nodeModulesPath
        process.environment = env

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let str = String(data: data, encoding: .utf8) else { return }
            guard let self = self else { return }
            self.stdoutBuffer += str
            let lines = self.stdoutBuffer.components(separatedBy: .newlines)
            self.stdoutBuffer = lines.last ?? ""
            for line in lines.dropLast() where !line.isEmpty {
                self.processLogLine(line)
            }
        }

        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let str = String(data: data, encoding: .utf8) else { return }
            for line in str.components(separatedBy: .newlines) where !line.isEmpty {
                self?.logHandler("STDERR: \(line)")
            }
        }

        process.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.isPlaying = false
                self.nowPlaying = nil
                self.nowPlayingHandler?(nil)
                self.statusHandler(.disconnected)
                let exitCode = proc.terminationStatus
                if self.isShuttingDown {
                    self.logHandler("Process terminated (exit code: \(exitCode))")
                } else if self.restartCount < self.maxRestarts {
                    self.restartCount += 1
                    let delay = min(pow(2.0, Double(self.restartCount)), 30.0)
                    self.logHandler("Process exited unexpectedly (code: \(exitCode)). Restarting in \(Int(delay))s... (attempt \(self.restartCount)/\(self.maxRestarts))")
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                        self.start()
                    }
                } else {
                    self.logHandler("Process terminated (exit code: \(exitCode))")
                    self.restartCount = 0
                    self.logHandler("Max restart attempts reached. Click Restart to try again.")
                }
            }
        }

        do {
            try process.run()
            self.process = process
            self.stdoutPipe = stdoutPipe
            self.stderrPipe = stderrPipe
            logHandler("Started node shim.js (PID: \(process.processIdentifier))")
        } catch {
            logHandler("ERROR: Failed to start node: \(error.localizedDescription)")
        }
    }

    func stop(completion: (() -> Void)? = nil) {
        isShuttingDown = true
        if let process = process, process.isRunning {
            let proc = process
            let existingHandler = proc.terminationHandler
            proc.terminationHandler = { arg in
                DispatchQueue.main.async {
                    existingHandler?(arg)
                    completion?()
                }
            }
            proc.terminate()

            DispatchQueue.global().asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self = self else { return }
                if proc.isRunning {
                    kill(pid_t(proc.processIdentifier), SIGKILL)
                }
                DispatchQueue.main.async {
                    self.cleanupPipes()
                }
            }
        } else {
            completion?()
            cleanupPipes()
        }

        let ipcPath = "/tmp/mpv-ipc.sock"
        if FileManager.default.fileExists(atPath: ipcPath) {
            try? FileManager.default.removeItem(atPath: ipcPath)
        }
    }

    private func cleanupPipes() {
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        stdoutPipe = nil
        stderrPipe = nil
        process = nil
        stdoutBuffer = ""
    }

    func sendMpvCommand(_ command: String) {
        let ipcPath = "/tmp/mpv-ipc.sock"
        guard FileManager.default.fileExists(atPath: ipcPath) else {
            logHandler("WARN: MPV IPC socket not found at \(ipcPath)")
            return
        }

        DispatchQueue.global().async {
            let sock = socket(AF_UNIX, SOCK_STREAM, 0)
            guard sock >= 0 else {
                return
            }
            defer { close(sock) }

            var noSigPipe: Int32 = 1
            setsockopt(sock, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))

            var addr = sockaddr_un()
            addr.sun_family = sa_family_t(AF_UNIX)
            let pathBytes = Array(ipcPath.utf8CString)
            withUnsafeMutableBytes(of: &addr.sun_path) { buf in
                guard let baseAddr = buf.baseAddress else { return }
                _ = memcpy(baseAddr, pathBytes, min(pathBytes.count, buf.count))
            }

            let addrLen = socklen_t(MemoryLayout<sockaddr_un>.size)
            let connected = withUnsafePointer(to: &addr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                    connect(sock, sockPtr, addrLen)
                }
            }

            guard connected == 0 else { return }

            let json = "\(command)\n"
            guard let data = json.data(using: .utf8) else { return }

            var totalSent = 0
            while totalSent < data.count {
                let result = data.withUnsafeBytes { buf -> Int in
                    guard let ptr = buf.baseAddress?.advanced(by: totalSent) else { return -1 }
                    return send(sock, ptr, data.count - totalSent, 0)
                }
                if result <= 0 { break }
                totalSent += result
            }
        }
    }

    func togglePause() {
        isPaused.toggle()
        sendMpvCommand("{\"command\": [\"set_property\", \"pause\", \(isPaused)]}")
    }

    func stopPlayback() {
        isPlaying = false
        isPaused = false
        nowPlaying = nil
        nowPlayingHandler?(nil)
        statusHandler(.connected)
        sendMpvCommand("{\"command\": [\"quit\"]}")
    }

    private func processLogLine(_ line: String) {
        if line.hasPrefix("AV:") { return }

        logHandler(line)

        if line.contains("WebSocket connection established") {
            statusHandler(.connected)
            restartCount = 0
            notificationHandler("Connected", "Connected to Jellyfin server")
        } else if line.contains("Episode detected") {
            if let title = extractTitleFromEpisode(line) {
                nowPlaying = title
                nowPlayingHandler?(title)
            }
            isPlaying = true
            statusHandler(.playing)
        } else if line.contains("File loaded by MPV") {
            if !isPlaying {
                isPlaying = true
                statusHandler(.playing)
            }
        } else if line.contains("Closing application") || line.contains("MPV closed") || line.contains("Process terminated") {
            isPlaying = false
            isPaused = false
            nowPlaying = nil
            nowPlayingHandler?(nil)
            statusHandler(.connected)
        } else if line.hasPrefix("ERROR") || line.hasPrefix("error") || line.contains("FATAL") {
            notificationHandler("Error", line)
        }
    }

    private func extractTitleFromEpisode(_ line: String) -> String? {
        if let range = line.range(of: "Episode detected: ") {
            return String(line[range.upperBound...])
        }
        if let range = line.range(of: "--force-media-title=") {
            let after = String(line[range.upperBound...])
            if let end = after.range(of: " ") {
                return String(after[..<end.lowerBound])
            }
            return after.trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

    private func applicationSupportDir() -> String {
        let paths = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
        guard let appSupport = paths.first else {
            let fallback = NSHomeDirectory() + "/Library/Application Support/JellyfinMpvPlay"
            return fallback
        }
        return appSupport.appendingPathComponent("JellyfinMpvPlay").path
    }

    private func setupApplicationSupport() {
        let appSupport = applicationSupportDir()
        let dataDir = appSupport + "/data"
        let bundleResources = Bundle.main.resourcePath ?? ""

        try? FileManager.default.createDirectory(atPath: appSupport, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: dataDir, withIntermediateDirectories: true)

        let shimDest = appSupport + "/shim.js"
        if !FileManager.default.fileExists(atPath: shimDest) {
            try? FileManager.default.copyItem(atPath: bundleResources + "/shim.js", toPath: shimDest)
        }

        let configFile = appSupport + "/config.js"
        if !FileManager.default.fileExists(atPath: configFile) {
            let exampleConfig = bundleResources + "/config.example.js"
            try? FileManager.default.copyItem(atPath: exampleConfig, toPath: configFile)
        }
    }

    private func findNodePath() -> String {
        let paths = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ]
        for path in paths {
            if FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
        }
        let nvmBase = NSHomeDirectory() + "/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmBase) {
            let sorted = versions.sorted { $0.compare($1, options: .numeric) == .orderedDescending }
            for v in sorted {
                let nodePath = "\(nvmBase)/\(v)/bin/node"
                if FileManager.default.isExecutableFile(atPath: nodePath) {
                    return nodePath
                }
            }
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-c", "which node"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return "node"
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        if let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !output.isEmpty {
            return output
        }
        return "node"
    }
}
