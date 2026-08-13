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
    private var shutdownCompletion: (() -> Void)?
    private(set) var nowPlaying: String?
    var nowPlayingHandler: ((String?) -> Void)?
    var pauseStateHandler: ((Bool) -> Void)?
    private var isPaused = false
    private var stdoutData = Data()
    private var stderrData = Data()
    private var ipcSocketPath = "/tmp/mpv-ipc.sock"
    private var isStoppingPlayback = false

    init(logHandler: @escaping (String) -> Void, statusHandler: @escaping (ConnectionStatus) -> Void, notificationHandler: @escaping (String, String) -> Void, nowPlayingHandler: ((String?) -> Void)? = nil) {
        self.logHandler = logHandler
        self.statusHandler = statusHandler
        self.notificationHandler = notificationHandler
        self.nowPlayingHandler = nowPlayingHandler
    }

    func start() {
        if let process = process, process.isRunning {
            process.terminationHandler = nil
            process.terminate()
            cleanupPipes()
        }
        isShuttingDown = false
        isStoppingPlayback = false
        let appSupport = ConfigParser.applicationSupportDir()
        let bundleResources = Bundle.main.resourcePath ?? ""
        let shimPath = appSupport + "/shim.js"
        let nodeModulesPath = bundleResources + "/node_modules"

        setupApplicationSupport()
        loadIpcSocketPath()

        guard FileManager.default.fileExists(atPath: shimPath) else {
            logHandler("ERROR: shim.js not found at \(shimPath)")
            return
        }

        let nodePath = findNodePath()
        guard !nodePath.isEmpty else {
            logHandler("ERROR: Node.js not found. Install Node.js or ensure it's bundled.")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
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
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.stdoutData.append(data)
                guard let str = String(data: self.stdoutData, encoding: .utf8) else { return }
                self.stdoutData = Data()
                let lines = str.components(separatedBy: .newlines)
                let complete = lines.dropLast()
                if let last = lines.last, !last.isEmpty {
                    self.stdoutData = Data(last.utf8)
                }
                for line in complete where !line.isEmpty {
                    self.processLogLine(line)
                }
            }
        }

        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.stderrData.append(data)
                guard let str = String(data: self.stderrData, encoding: .utf8) else { return }
                self.stderrData = Data()
                let lines = str.components(separatedBy: .newlines)
                let complete = lines.dropLast()
                if let last = lines.last, !last.isEmpty {
                    self.stderrData = Data(last.utf8)
                }
                for line in complete where !line.isEmpty {
                    self.logHandler("STDERR: \(line)")
                    self.processLogLine("STDERR: \(line)")
                }
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
        if isShuttingDown {
            if let completion = completion {
                let existing = shutdownCompletion
                shutdownCompletion = { existing?(); completion() }
            }
            return
        }
        isShuttingDown = true
        shutdownCompletion = completion
        let ipcPath = ipcSocketPath
        if let process = process, process.isRunning {
            let proc = process
            proc.terminationHandler = { [weak self] arg in
                if FileManager.default.fileExists(atPath: ipcPath) {
                    try? FileManager.default.removeItem(atPath: ipcPath)
                }
                DispatchQueue.main.async {
                    self?.shutdownCompletion?()
                    self?.shutdownCompletion = nil
                }
            }
            proc.terminate()

            DispatchQueue.global().asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self = self else { return }
                if proc.isRunning {
                    kill(pid_t(proc.processIdentifier), SIGKILL)
                }
                DispatchQueue.main.async {
                    if self.process === proc {
                        self.cleanupPipes()
                    }
                }
            }
        } else {
            if FileManager.default.fileExists(atPath: ipcPath) {
                try? FileManager.default.removeItem(atPath: ipcPath)
            }
            shutdownCompletion?()
            shutdownCompletion = nil
            cleanupPipes()
        }
    }

    private func cleanupPipes() {
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        stdoutPipe = nil
        stderrPipe = nil
        process = nil
        stdoutData = Data()
        stderrData = Data()
    }

    private func loadIpcSocketPath() {
        guard let content = ConfigParser.loadConfigContent() else { return }
        let path = ConfigParser.extractValue(from: content, key: "ipcSocketPath")
        if !path.isEmpty { ipcSocketPath = path }
    }

    func sendMpvCommand(_ command: String) {
        let path = ipcSocketPath
        guard FileManager.default.fileExists(atPath: path) else {
            logHandler("WARN: MPV IPC socket not found at \(path)")
            return
        }

        DispatchQueue.global().async {
            let sock = socket(AF_UNIX, SOCK_STREAM, 0)
            guard sock >= 0 else { return }
            defer { close(sock) }

            var noSigPipe: Int32 = 1
            setsockopt(sock, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))

            var addr = sockaddr_un()
            addr.sun_family = sa_family_t(AF_UNIX)
            let pathBytes = Array(path.utf8CString)
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

            guard connected == 0 else {
                DispatchQueue.main.async { [weak self] in
                    self?.logHandler("WARN: Failed to connect to MPV IPC socket")
                }
                return
            }

            let json = "\(command)\n"
            guard let data = json.data(using: .utf8) else { return }

            var totalSent = 0
            while totalSent < data.count {
                let result = data.withUnsafeBytes { buf -> Int in
                    guard let ptr = buf.baseAddress?.advanced(by: totalSent) else { return -1 }
                    return send(sock, ptr, data.count - totalSent, 0)
                }
                if result <= 0 {
                    DispatchQueue.main.async { [weak self] in
                        self?.logHandler("WARN: Failed to send MPV IPC command")
                    }
                    break
                }
                totalSent += result
            }
        }
    }

    func togglePause() {
        guard !isStoppingPlayback else { return }
        // Send toggle command — actual state is updated by processLogLine via pauseStateHandler
        sendMpvCommand("{\"command\": [\"set_property\", \"pause\", \(!isPaused)]}")
    }

    func stopPlayback() {
        isStoppingPlayback = true
        resetPlaybackState()
        sendMpvCommand("{\"command\": [\"quit\"]}")
    }

    private func resetPlaybackState() {
        isPlaying = false
        isPaused = false
        nowPlaying = nil
        nowPlayingHandler?(nil)
        pauseStateHandler?(false)
        statusHandler(.connected)
    }

    private func processLogLine(_ line: String) {
        if line.hasPrefix("AV:") { return }

        logHandler(line)

        if line.contains("WebSocket connection established") {
            statusHandler(.connected)
            restartCount = 0
            notificationHandler("Connected", "Connected to Jellyfin server")
        } else if line.contains("Episode detected") {
            if isStoppingPlayback { return }
            if let title = extractTitleFromEpisode(line) {
                nowPlaying = title
                nowPlayingHandler?(title)
            }
            isPlaying = true
            statusHandler(.playing)
        } else if line.contains("File loaded by MPV") {
            if isStoppingPlayback { return }
            if !isPlaying {
                isPlaying = true
                statusHandler(.playing)
            }
        } else if line.contains("Starting next episode") || line.contains("Starting previous episode") {
            if let title = extractTitleFromNextEpisode(line) {
                nowPlaying = title
                nowPlayingHandler?(title)
            }
        } else if line.contains("Playback paused") {
            if isStoppingPlayback { return }
            isPaused = true
            pauseStateHandler?(true)
        } else if line.contains("Playback resumed") {
            if isStoppingPlayback { return }
            isPaused = false
            pauseStateHandler?(false)
        } else if line.contains("No more episodes") {
            isStoppingPlayback = false
            resetPlaybackState()
        } else if line.contains("Closing application") || line.contains("MPV closed") || line.contains("Process terminated") {
            isStoppingPlayback = false
            resetPlaybackState()
        } else if line.contains("ERROR") || line.contains("❌") || line.contains("FATAL") {
            notificationHandler("Error", line)
        }
    }

    private func extractTitleFromNextEpisode(_ line: String) -> String? {
        if let range = line.range(of: "Starting next episode: ") {
            return String(line[range.upperBound...])
        }
        if let range = line.range(of: "Starting previous episode: ") {
            return String(line[range.upperBound...])
        }
        return nil
    }

    private func extractTitleFromEpisode(_ line: String) -> String? {
        if let range = line.range(of: "Episode detected: ") {
            return String(line[range.upperBound...])
        }
        if let range = line.range(of: "--force-media-title=") {
            let after = String(line[range.upperBound...])
            if after.hasPrefix("\"") {
                let withoutQuote = String(after.dropFirst())
                if let endQuote = withoutQuote.range(of: "\"") {
                    return String(withoutQuote[..<endQuote.lowerBound])
                }
                return withoutQuote.trimmingCharacters(in: .whitespaces)
            } else if after.hasPrefix("'") {
                let withoutQuote = String(after.dropFirst())
                if let endQuote = withoutQuote.range(of: "'") {
                    return String(withoutQuote[..<endQuote.lowerBound])
                }
                return withoutQuote.trimmingCharacters(in: .whitespaces)
            }
            if let end = after.range(of: " ") {
                return String(after[..<end.lowerBound])
            }
            return after.trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

    private func setupApplicationSupport() {
        let appSupport = ConfigParser.applicationSupportDir()
        let dataDir = appSupport + "/data"
        let bundleResources = Bundle.main.resourcePath ?? ""

        try? FileManager.default.createDirectory(atPath: appSupport, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: dataDir, withIntermediateDirectories: true)

        let shimDest = appSupport + "/shim.js"
        let bundledShim = bundleResources + "/shim.js"
        try? FileManager.default.removeItem(atPath: shimDest)
        try? FileManager.default.copyItem(atPath: bundledShim, toPath: shimDest)

        let pkgDest = appSupport + "/package.json"
        let bundledPkg = bundleResources + "/package.json"
        try? FileManager.default.removeItem(atPath: pkgDest)
        try? FileManager.default.copyItem(atPath: bundledPkg, toPath: pkgDest)

        let configFile = appSupport + "/config.js"
        if !FileManager.default.fileExists(atPath: configFile) {
            let exampleConfig = bundleResources + "/config.example.js"
            try? FileManager.default.copyItem(atPath: exampleConfig, toPath: configFile)
        }
    }

    private func findNodePath() -> String {
        // Prefer bundled Node from app Resources
        if let bundlePath = Bundle.main.resourcePath {
            let bundledNode = "\(bundlePath)/node/bin/node"
            if FileManager.default.isExecutableFile(atPath: bundledNode) {
                logHandler("Using bundled node: \(bundledNode)")
                return bundledNode
            }
        }

        // Fall back to system Node
        let paths = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ]
        for path in paths {
            if FileManager.default.isExecutableFile(atPath: path) {
                logHandler("Using system node: \(path)")
                return path
            }
        }
        let nvmBase = NSHomeDirectory() + "/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmBase) {
            let sorted = versions.sorted { $0.compare($1, options: .numeric) == .orderedDescending }
            for v in sorted {
                let nodePath = "\(nvmBase)/\(v)/bin/node"
                if FileManager.default.isExecutableFile(atPath: nodePath) {
                    logHandler("Using nvm node: \(nodePath)")
                    return nodePath
                }
            }
        }
        logHandler("ERROR: node not found in bundle or system")
        return ""
    }
}
