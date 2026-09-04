import Cocoa
import ServiceManagement

class PreferencesWindowController: NSWindowController {
    private var serverUrlField: NSTextField!
    private var usernameField: NSTextField!
    private var passwordField: NSSecureTextField!
    private var mpvPathField: NSTextField!
    private var deviceNameField: NSTextField!
    private var deviceIdField: NSTextField!
    private var ipcSocketPathField: NSTextField!
    private var mpvFlagsField: NSTextField!
    private var fullscreenCheckbox: NSButton!
    private var autoCloseCheckbox: NSButton!
    private var headlessCheckbox: NSButton!
    private var autoSkipIntrosCheckbox: NSButton!
    private var disableSkipIntroCheckbox: NSButton!
    private var verboseCheckbox: NSButton!
    private var testButton: NSButton!
    private var statusLabel: NSTextField!
    private var launchAtLoginCheckbox: NSButton!
    var onSave: (() -> Void)?

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 670),
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

    override func showWindow(_ sender: Any?) {
        super.showWindow(sender)
        window?.makeFirstResponder(nil)
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }

        var yOffset: CGFloat = 630

        // MARK: - Connection Section
        let connectionLabel = sectionLabel("Connection")
        connectionLabel.frame = NSRect(x: 20, y: yOffset, width: 520, height: 20)
        contentView.addSubview(connectionLabel)
        yOffset -= 30

        // Server URL
        let serverLabel = NSTextField(labelWithString: "Server URL:")
        serverLabel.frame = NSRect(x: 20, y: yOffset, width: 100, height: 24)
        serverLabel.alignment = .right
        contentView.addSubview(serverLabel)

        serverUrlField = NSTextField()
        serverUrlField.frame = NSRect(x: 130, y: yOffset, width: 410, height: 24)
        contentView.addSubview(serverUrlField)
        yOffset -= 36

        // Username
        let userLabel = NSTextField(labelWithString: "Username:")
        userLabel.frame = NSRect(x: 20, y: yOffset, width: 100, height: 24)
        userLabel.alignment = .right
        contentView.addSubview(userLabel)

        usernameField = NSTextField()
        usernameField.frame = NSRect(x: 130, y: yOffset, width: 410, height: 24)
        contentView.addSubview(usernameField)
        yOffset -= 36

        // Password
        let passLabel = NSTextField(labelWithString: "Password:")
        passLabel.frame = NSRect(x: 20, y: yOffset, width: 100, height: 24)
        passLabel.alignment = .right
        contentView.addSubview(passLabel)

        passwordField = NSSecureTextField()
        passwordField.frame = NSRect(x: 130, y: yOffset, width: 410, height: 24)
        contentView.addSubview(passwordField)
        yOffset -= 36

        // Test Connection
        testButton = NSButton(title: "Test Connection", target: self, action: #selector(testConnection))
        testButton.frame = NSRect(x: 130, y: yOffset, width: 130, height: 28)
        testButton.bezelStyle = .rounded
        contentView.addSubview(testButton)

        statusLabel = NSTextField(labelWithString: "")
        statusLabel.frame = NSRect(x: 270, y: yOffset + 4, width: 290, height: 20)
        statusLabel.font = NSFont.systemFont(ofSize: 12)
        statusLabel.maximumNumberOfLines = 1
        statusLabel.lineBreakMode = .byTruncatingTail
        contentView.addSubview(statusLabel)
        yOffset -= 30

        // Separator
        let separator1 = NSBox()
        separator1.boxType = .separator
        separator1.frame = NSRect(x: 20, y: yOffset, width: 540, height: 1)
        contentView.addSubview(separator1)
        yOffset -= 20

        // MARK: - Playback Section
        let playbackLabel = sectionLabel("Playback")
        playbackLabel.frame = NSRect(x: 20, y: yOffset, width: 520, height: 20)
        contentView.addSubview(playbackLabel)
        yOffset -= 30

        // MPV Path with Browse button
        let mpvLabel = NSTextField(labelWithString: "MPV Path:")
        mpvLabel.frame = NSRect(x: 20, y: yOffset, width: 100, height: 24)
        mpvLabel.alignment = .right
        contentView.addSubview(mpvLabel)

        mpvPathField = NSTextField()
        mpvPathField.frame = NSRect(x: 130, y: yOffset, width: 320, height: 24)
        contentView.addSubview(mpvPathField)

        let browseButton = NSButton(title: "Browse...", target: self, action: #selector(browseMpvPath))
        browseButton.frame = NSRect(x: 458, y: yOffset, width: 80, height: 24)
        browseButton.bezelStyle = .rounded
        contentView.addSubview(browseButton)
        yOffset -= 36

        // Device Name
        let deviceNameLabel = NSTextField(labelWithString: "Device Name:")
        deviceNameLabel.frame = NSRect(x: 20, y: yOffset, width: 100, height: 24)
        deviceNameLabel.alignment = .right
        contentView.addSubview(deviceNameLabel)

        deviceNameField = NSTextField()
        deviceNameField.frame = NSRect(x: 130, y: yOffset, width: 410, height: 24)
        contentView.addSubview(deviceNameField)
        yOffset -= 36

        // Device ID
        let deviceIdLabel = NSTextField(labelWithString: "Device ID:")
        deviceIdLabel.frame = NSRect(x: 20, y: yOffset, width: 100, height: 24)
        deviceIdLabel.alignment = .right
        contentView.addSubview(deviceIdLabel)

        deviceIdField = NSTextField()
        deviceIdField.frame = NSRect(x: 130, y: yOffset, width: 410, height: 24)
        contentView.addSubview(deviceIdField)
        yOffset -= 36

        // IPC Socket Path
        let ipcLabel = NSTextField(labelWithString: "IPC Socket:")
        ipcLabel.frame = NSRect(x: 20, y: yOffset, width: 100, height: 24)
        ipcLabel.alignment = .right
        contentView.addSubview(ipcLabel)

        ipcSocketPathField = NSTextField()
        ipcSocketPathField.frame = NSRect(x: 130, y: yOffset, width: 410, height: 24)
        ipcSocketPathField.placeholderString = "/tmp/mpv-ipc.sock"
        contentView.addSubview(ipcSocketPathField)
        yOffset -= 36

        // MPV Flags
        let flagsLabel = NSTextField(labelWithString: "MPV Flags:")
        flagsLabel.frame = NSRect(x: 20, y: yOffset, width: 100, height: 24)
        flagsLabel.alignment = .right
        contentView.addSubview(flagsLabel)

        mpvFlagsField = NSTextField()
        mpvFlagsField.frame = NSRect(x: 130, y: yOffset, width: 410, height: 24)
        mpvFlagsField.placeholderString = "--hwdec=auto, --vo=gpu-next"
        contentView.addSubview(mpvFlagsField)
        yOffset -= 30

        // Separator
        let separator2 = NSBox()
        separator2.boxType = .separator
        separator2.frame = NSRect(x: 20, y: yOffset, width: 540, height: 1)
        contentView.addSubview(separator2)
        yOffset -= 20

        // MARK: - Options Section
        let optionsLabel = sectionLabel("Options")
        optionsLabel.frame = NSRect(x: 20, y: yOffset, width: 540, height: 20)
        contentView.addSubview(optionsLabel)
        yOffset -= 28

        // Checkboxes in two columns
        let leftX: CGFloat = 130
        let rightX: CGFloat = 340
        let checkboxWidth: CGFloat = 200
        let checkboxHeight: CGFloat = 22
        let rowSpacing: CGFloat = 26

        // Row 1
        fullscreenCheckbox = NSButton(checkboxWithTitle: "Start in fullscreen", target: nil, action: nil)
        fullscreenCheckbox.frame = NSRect(x: leftX, y: yOffset, width: checkboxWidth, height: checkboxHeight)
        contentView.addSubview(fullscreenCheckbox)

        autoCloseCheckbox = NSButton(checkboxWithTitle: "Close when playback ends", target: nil, action: nil)
        autoCloseCheckbox.frame = NSRect(x: rightX, y: yOffset, width: checkboxWidth, height: checkboxHeight)
        contentView.addSubview(autoCloseCheckbox)
        yOffset -= rowSpacing

        // Row 2
        headlessCheckbox = NSButton(checkboxWithTitle: "Headless mode", target: nil, action: nil)
        headlessCheckbox.frame = NSRect(x: leftX, y: yOffset, width: checkboxWidth, height: checkboxHeight)
        contentView.addSubview(headlessCheckbox)

        autoSkipIntrosCheckbox = NSButton(checkboxWithTitle: "Auto-skip intros/outros", target: nil, action: nil)
        autoSkipIntrosCheckbox.frame = NSRect(x: rightX, y: yOffset, width: checkboxWidth, height: checkboxHeight)
        contentView.addSubview(autoSkipIntrosCheckbox)
        yOffset -= rowSpacing

        // Row 3
        disableSkipIntroCheckbox = NSButton(checkboxWithTitle: "Disable skip intro feature", target: nil, action: nil)
        disableSkipIntroCheckbox.frame = NSRect(x: leftX, y: yOffset, width: checkboxWidth, height: checkboxHeight)
        contentView.addSubview(disableSkipIntroCheckbox)

        verboseCheckbox = NSButton(checkboxWithTitle: "Verbose logging", target: nil, action: nil)
        verboseCheckbox.frame = NSRect(x: rightX, y: yOffset, width: checkboxWidth, height: checkboxHeight)
        contentView.addSubview(verboseCheckbox)
        yOffset -= 20

        // Separator
        let separator3 = NSBox()
        separator3.boxType = .separator
        separator3.frame = NSRect(x: 20, y: yOffset, width: 520, height: 1)
        contentView.addSubview(separator3)
        yOffset -= 20

        // MARK: - General Section
        launchAtLoginCheckbox = NSButton(checkboxWithTitle: "Launch at login", target: self, action: #selector(toggleLaunchAtLogin))
        launchAtLoginCheckbox.frame = NSRect(x: 130, y: yOffset, width: 200, height: 22)
        launchAtLoginCheckbox.state = SMAppService.mainApp.status == .enabled ? .on : .off
        contentView.addSubview(launchAtLoginCheckbox)

        // MARK: - Bottom buttons
        let saveButton = NSButton(title: "Save", target: self, action: #selector(saveConfig))
        saveButton.frame = NSRect(x: 380, y: 20, width: 80, height: 32)
        saveButton.keyEquivalent = "\r"
        contentView.addSubview(saveButton)

        let cancelButton = NSButton(title: "Cancel", target: self, action: #selector(cancel))
        cancelButton.frame = NSRect(x: 470, y: 20, width: 80, height: 32)
        contentView.addSubview(cancelButton)
    }

    private func sectionLabel(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = NSFont.boldSystemFont(ofSize: 13)
        label.textColor = .secondaryLabelColor
        return label
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

        var ipcPath = ConfigParser.extractValue(from: content, key: "ipcSocketPath")
        if ipcPath.isEmpty { ipcPath = "/tmp/mpv-ipc.sock" }
        ipcSocketPathField.stringValue = ipcPath

        mpvFlagsField.stringValue = ConfigParser.extractValue(from: content, key: "mpvFlags")

        fullscreenCheckbox.state = ConfigParser.extractValue(from: content, key: "fullscreen") == "true" ? .on : .off
        autoCloseCheckbox.state = ConfigParser.extractValue(from: content, key: "autoClose") == "true" ? .on : .off
        headlessCheckbox.state = ConfigParser.extractValue(from: content, key: "headless") == "true" ? .on : .off
        autoSkipIntrosCheckbox.state = ConfigParser.extractValue(from: content, key: "autoSkipIntros") == "true" ? .on : .off
        disableSkipIntroCheckbox.state = ConfigParser.extractValue(from: content, key: "disableSkipIntro") == "true" ? .on : .off
        verboseCheckbox.state = ConfigParser.extractValue(from: content, key: "verbose") == "true" ? .on : .off
    }

    @objc private func browseMpvPath() {
        let panel = NSOpenPanel()
        panel.title = "Select MPV Binary"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
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

        var lines: [String] = [
            "module.exports = {",
            "    serverUrl: '\(ConfigParser.escapeConfigValue(serverUrlField.stringValue))',",
            "    username: '\(ConfigParser.escapeConfigValue(usernameField.stringValue))',",
            "    password: '\(ConfigParser.escapeConfigValue(passwordField.stringValue))',",
            "    mpvPath: '\(ConfigParser.escapeConfigValue(mpvPathField.stringValue))',",
            "    deviceName: '\(ConfigParser.escapeConfigValue(deviceNameField.stringValue))',",
            "    deviceId: '\(ConfigParser.escapeConfigValue(deviceIdField.stringValue))',",
        ]

        let ipcPath = ipcSocketPathField.stringValue.trimmingCharacters(in: .whitespaces)
        if !ipcPath.isEmpty {
            lines.append("    ipcSocketPath: '\(ConfigParser.escapeConfigValue(ipcPath))',")
        }
        let mpvFlags = mpvFlagsField.stringValue.trimmingCharacters(in: .whitespaces)
        if !mpvFlags.isEmpty {
            // Parse comma-separated flags into a JS array
            let flags = mpvFlags.components(separatedBy: ",").map { "'\($0.trimmingCharacters(in: .whitespaces))'" }.joined(separator: ", ")
            lines.append("    mpvFlags: [\(flags)],")
        }

        lines.append("    fullscreen: \(fullscreenCheckbox.state == .on ? "true" : "false"),")
        lines.append("    autoClose: \(autoCloseCheckbox.state == .on ? "true" : "false"),")
        lines.append("    headless: \(headlessCheckbox.state == .on ? "true" : "false"),")
        lines.append("    autoSkipIntros: \(autoSkipIntrosCheckbox.state == .on ? "true" : "false"),")
        lines.append("    disableSkipIntro: \(disableSkipIntroCheckbox.state == .on ? "true" : "false"),")
        lines.append("    verbose: \(verboseCheckbox.state == .on ? "true" : "false"),")
        lines.append("};")

        let config = lines.joined(separator: "\n")
        let configPath = ConfigParser.configPath()
        do {
            try config.write(toFile: configPath, atomically: true, encoding: .utf8)
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
