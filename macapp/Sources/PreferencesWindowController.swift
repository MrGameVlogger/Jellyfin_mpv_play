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

        serverUrlField = NSTextField()
        usernameField = NSTextField()
        passwordField = NSSecureTextField()
        mpvPathField = NSTextField()
        deviceNameField = NSTextField()
        deviceIdField = NSTextField()

        let fields: [NSTextField] = [serverUrlField, usernameField, passwordField, mpvPathField, deviceNameField, deviceIdField]

        for (i, label) in labels.enumerated() {
            let labelView = NSTextField(labelWithString: label)
            labelView.frame = NSRect(x: 20, y: 330 - i * 40, width: 100, height: 24)
            labelView.alignment = .right
            contentView.addSubview(labelView)

            fields[i].frame = NSRect(x: 130, y: 330 - i * 40, width: 310, height: 24)
            contentView.addSubview(fields[i])
        }

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
        saveButton.keyEquivalent = "\r"
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
        guard let content = ConfigParser.loadConfigContent() else { return }

        serverUrlField.stringValue = ConfigParser.extractValue(from: content, key: "serverUrl")
        usernameField.stringValue = ConfigParser.extractValue(from: content, key: "username")
        passwordField.stringValue = ConfigParser.extractValue(from: content, key: "password")

        var mpvPath = ConfigParser.extractValue(from: content, key: "mpvPath")
        if mpvPath.isEmpty { mpvPath = "/opt/homebrew/bin/mpv" }
        mpvPathField.stringValue = mpvPath

        var deviceName = ConfigParser.extractValue(from: content, key: "deviceName")
        if deviceName.isEmpty { deviceName = "Mac" }
        deviceNameField.stringValue = deviceName

        var deviceId = ConfigParser.extractValue(from: content, key: "deviceId")
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

        let deviceId = deviceIdField.stringValue.isEmpty ? "test-device" : deviceIdField.stringValue
        let deviceName = deviceNameField.stringValue.isEmpty ? "Jellyfin MPV Play" : deviceNameField.stringValue

        ConfigParser.testConnection(server: serverUrlField.stringValue, username: usernameField.stringValue, password: passwordField.stringValue, deviceId: deviceId, deviceName: deviceName) { [weak self] success, message in
            self?.testButton.isEnabled = true
            self?.statusLabel.stringValue = message
            self?.statusLabel.textColor = success ? .systemGreen : .systemRed
        }
    }

    @objc private func saveConfig() {
        guard !serverUrlField.stringValue.isEmpty,
              !usernameField.stringValue.isEmpty,
              !passwordField.stringValue.isEmpty else {
            let alert = NSAlert()
            alert.messageText = "Missing required fields"
            alert.informativeText = "Server URL, Username, and Password are required."
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.runModal()
            return
        }

        let config = """
        module.exports = {
            serverUrl: '\(ConfigParser.escapeConfigValue(serverUrlField.stringValue))',
            username: '\(ConfigParser.escapeConfigValue(usernameField.stringValue))',
            password: '\(ConfigParser.escapeConfigValue(passwordField.stringValue))',
            mpvPath: '\(ConfigParser.escapeConfigValue(mpvPathField.stringValue))',
            deviceName: '\(ConfigParser.escapeConfigValue(deviceNameField.stringValue))',
            deviceId: '\(ConfigParser.escapeConfigValue(deviceIdField.stringValue))'
        };
        """
        let dedented = config.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")
        let configPath = ConfigParser.configPath()
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
}
