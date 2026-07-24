import Cocoa
import ServiceManagement

class PreferencesWindowController: NSWindowController {
    private var serverUrlField: NSTextField!
    private var usernameField: NSTextField!
    private var passwordField: NSSecureTextField!
    private var mpvPathField: NSTextField!
    private var deviceNameField: NSTextField!
    private var deviceIdField: NSTextField!
    private var testButton: NSButton!
    private var statusLabel: NSTextField!
    private var launchAtLoginCheckbox: NSButton!
    var onSave: (() -> Void)?

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 380),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Preferences"
        window.center()
        window.isReleasedWhenClosed = false

        self.init(window: window)
        setupUI()
        loadConfig()
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }

        let labels = ["Server URL:", "Username:", "Password:", "MPV Path:", "Device Name:", "Device ID:"]
        let fields: [NSTextField] = [
            NSTextField(), NSTextField(), NSSecureTextField(), NSTextField(), NSTextField(), NSTextField()
        ]

        for (i, label) in labels.enumerated() {
            let labelView = NSTextField(labelWithString: label)
            labelView.frame = NSRect(x: 20, y: 330 - i * 40, width: 100, height: 24)
            labelView.alignment = .right
            contentView.addSubview(labelView)

            fields[i].frame = NSRect(x: 130, y: 330 - i * 40, width: 310, height: 24)
            contentView.addSubview(fields[i])
        }

        serverUrlField = fields[0]
        usernameField = fields[1]
        passwordField = fields[2] as? NSSecureTextField
        mpvPathField = fields[3]
        deviceNameField = fields[4]
        deviceIdField = fields[5]

        let browseButton = NSButton(title: "Browse...", target: self, action: #selector(browseMpvPath))
        browseButton.frame = NSRect(x: 448, y: 330 - 3 * 40, width: 80, height: 24)
        browseButton.bezelStyle = .rounded
        contentView.addSubview(browseButton)

        testButton = NSButton(title: "Test Connection", target: self, action: #selector(testConnection))
        testButton.frame = NSRect(x: 130, y: 70, width: 130, height: 32)
        testButton.bezelStyle = .rounded
        contentView.addSubview(testButton)

        statusLabel = NSTextField(labelWithString: "")
        statusLabel.frame = NSRect(x: 270, y: 70, width: 270, height: 32)
        statusLabel.font = NSFont.systemFont(ofSize: 12)
        contentView.addSubview(statusLabel)

        let saveButton = NSButton(title: "Save", target: self, action: #selector(saveConfig))
        saveButton.frame = NSRect(x: 380, y: 20, width: 80, height: 32)
        contentView.addSubview(saveButton)

        let cancelButton = NSButton(title: "Cancel", target: self, action: #selector(cancel))
        cancelButton.frame = NSRect(x: 470, y: 20, width: 80, height: 32)
        contentView.addSubview(cancelButton)

        launchAtLoginCheckbox = NSButton(checkboxWithTitle: "Launch at login", target: self, action: #selector(toggleLaunchAtLogin))
        launchAtLoginCheckbox.frame = NSRect(x: 130, y: 38, width: 200, height: 22)
        launchAtLoginCheckbox.state = SMAppService.mainApp.status == .enabled ? .on : .off
        contentView.addSubview(launchAtLoginCheckbox)
    }

    private func loadConfig() {
        let configPath = findConfigPath()
        guard let content = try? String(contentsOfFile: configPath, encoding: .utf8) else { return }

        serverUrlField.stringValue = extractValue(from: content, key: "serverUrl")
        usernameField.stringValue = extractValue(from: content, key: "username")
        passwordField.stringValue = extractValue(from: content, key: "password")

        var mpvPath = extractValue(from: content, key: "mpvPath")
        if mpvPath.isEmpty { mpvPath = "/opt/homebrew/bin/mpv" }
        mpvPathField.stringValue = mpvPath

        var deviceName = extractValue(from: content, key: "deviceName")
        if deviceName.isEmpty { deviceName = "Mac" }
        deviceNameField.stringValue = deviceName

        var deviceId = extractValue(from: content, key: "deviceId")
        if deviceId.isEmpty { deviceId = "mac-mpv" }
        deviceIdField.stringValue = deviceId
    }

    @objc private func browseMpvPath() {
        let panel = NSOpenPanel()
        panel.title = "Select MPV Binary"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = []
        if !mpvPathField.stringValue.isEmpty {
            let url = URL(fileURLWithPath: mpvPathField.stringValue)
            panel.directoryURL = url.deletingLastPathComponent()
        }
        panel.begin { [weak self] response in
            if response == .OK, let url = panel.url {
                self?.mpvPathField.stringValue = url.path
            }
        }
    }

    @objc private func testConnection() {
        guard !serverUrlField.stringValue.isEmpty,
              !usernameField.stringValue.isEmpty,
              !passwordField.stringValue.isEmpty else {
            statusLabel.stringValue = "Fill in all fields first"
            statusLabel.textColor = .systemYellow
            return
        }

        testButton.isEnabled = false
        statusLabel.stringValue = "Testing..."
        statusLabel.textColor = .labelColor

        let urlString = serverUrlField.stringValue.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let username = usernameField.stringValue
        let password = passwordField.stringValue

        guard let url = URL(string: "\(urlString)/Users/AuthenticateByName"),
              let scheme = url.scheme?.lowercased(),
              (scheme == "http" || scheme == "https") else {
            statusLabel.stringValue = "Invalid URL (use http:// or https://)"
            statusLabel.textColor = .systemRed
            testButton.isEnabled = true
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        let deviceId = deviceIdField.stringValue.isEmpty ? "test-device" : deviceIdField.stringValue
        let deviceName = deviceNameField.stringValue.isEmpty ? "Jellyfin MPV Play" : deviceNameField.stringValue
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let authHeader = "MediaBrowser Client=\"Jellyfin MPV Play\", Device=\"\(deviceName)\", DeviceId=\"\(deviceId)\", Version=\"\(version)\""
        request.addValue(authHeader, forHTTPHeaderField: "X-Emby-Authorization")

        let body: [String: Any] = ["Username": username, "Pw": password]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                self?.testButton.isEnabled = true
                if let error = error {
                    self?.statusLabel.stringValue = "Failed: \(error.localizedDescription)"
                    self?.statusLabel.textColor = .systemRed
                    return
                }
                guard let httpResponse = response as? HTTPURLResponse else {
                    self?.statusLabel.stringValue = "Invalid response"
                    self?.statusLabel.textColor = .systemRed
                    return
                }
                if httpResponse.statusCode == 200 {
                    self?.statusLabel.stringValue = "Connected!"
                    self?.statusLabel.textColor = .systemGreen
                } else {
                    self?.statusLabel.stringValue = "Failed: HTTP \(httpResponse.statusCode)"
                    self?.statusLabel.textColor = .systemRed
                }
            }
        }.resume()
    }

    @objc private func saveConfig() {
        func escape(_ s: String) -> String {
            return s
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
                .replacingOccurrences(of: "\t", with: "\\t")
        }
        let config = """
        module.exports = {
            serverUrl: '\(escape(serverUrlField.stringValue))',
            username: '\(escape(usernameField.stringValue))',
            password: '\(escape(passwordField.stringValue))',
            mpvPath: '\(escape(mpvPathField.stringValue))',
            deviceName: '\(escape(deviceNameField.stringValue))',
            deviceId: '\(escape(deviceIdField.stringValue))'
        };
        """
        let dedented = config.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")
        let configPath = findConfigPath()
        do {
            try dedented.write(toFile: configPath, atomically: true, encoding: .utf8)
            onSave?()
            window?.close()
        } catch {
            let alert = NSAlert()
            alert.messageText = "Failed to save config"
            alert.informativeText = error.localizedDescription
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }

    @objc private func cancel() {
        window?.close()
    }

    @objc private func toggleLaunchAtLogin() {
        do {
            if launchAtLoginCheckbox.state == .on {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            launchAtLoginCheckbox.state = launchAtLoginCheckbox.state == .on ? .off : .on
            let alert = NSAlert()
            alert.messageText = "Failed to update login item"
            alert.informativeText = error.localizedDescription
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }

    private func findConfigPath() -> String {
        let appSupport = NSSearchPathForDirectoriesInDomains(.applicationSupportDirectory, .userDomainMask, true).first ?? ""
        let appDir = (appSupport as NSString).appendingPathComponent("JellyfinMpvPlay")
        return (appDir as NSString).appendingPathComponent("config.js")
    }

    private func extractValue(from content: String, key: String) -> String {
        let escapedKey = NSRegularExpression.escapedPattern(for: key)
        let pattern = "\(escapedKey):\\s*['\"]([^'\\\"]*(?:\\\\.[^'\\\"]*)*)['\"]"
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
              let range = Range(match.range(at: 1), in: content) else {
            let simplePattern = "\(escapedKey):\\s*['\"]([^'\"]*)['\"]"
            guard let regex = try? NSRegularExpression(pattern: simplePattern),
                  let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
                  let range = Range(match.range(at: 1), in: content) else {
                return ""
            }
            return String(content[range])
        }
        var result = String(content[range])
        result = result.replacingOccurrences(of: "\\\\", with: "\\")
        result = result.replacingOccurrences(of: "\\'", with: "'")
        result = result.replacingOccurrences(of: "\\n", with: "\n")
        result = result.replacingOccurrences(of: "\\r", with: "\r")
        result = result.replacingOccurrences(of: "\\t", with: "\t")
        return result
    }

    private func extractOptionalValue(from content: String, key: String) -> String? {
        let result = extractValue(from: content, key: key)
        return result.isEmpty ? nil : result
    }

    private func findConfigContent() -> String {
        let configPath = findConfigPath()
        return (try? String(contentsOfFile: configPath, encoding: .utf8)) ?? ""
    }
}
