import Cocoa
import ServiceManagement

class PreferencesWindowController: NSWindowController {
    private var serverUrlField: NSTextField!
    private var usernameField: NSTextField!
    private var passwordField: NSSecureTextField!
    private var mpvPathField: NSTextField!
    private var deviceNameField: NSTextField!
    private var deviceIdField: NSTextField!
    private var fullscreenCheckbox: NSButton!
    private var autoCloseCheckbox: NSButton!
    private var headlessCheckbox: NSButton!
    private var autoSkipIntrosCheckbox: NSButton!
    private var verboseCheckbox: NSButton!
    private var testButton: NSButton!
    private var statusLabel: NSTextField!
    private var launchAtLoginCheckbox: NSButton!
    var onSave: (() -> Void)?

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 520),
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
            labelView.frame = NSRect(x: 20, y: 470 - i * 40, width: 100, height: 24)
            labelView.alignment = .right
            contentView.addSubview(labelView)

            fields[i].frame = NSRect(x: 130, y: 472 - i * 40, width: 310, height: 24)
            contentView.addSubview(fields[i])
        }

        let browseButton = NSButton(title: "Browse...", target: self, action: #selector(browseMpvPath))
        browseButton.frame = NSRect(x: 448, y: 470 - 3 * 40, width: 80, height: 24)
        browseButton.bezelStyle = .rounded
        contentView.addSubview(browseButton)

        // Checkboxes for options
        fullscreenCheckbox = NSButton(checkboxWithTitle: "Start MPV in fullscreen", target: nil, action: nil)
        fullscreenCheckbox.frame = NSRect(x: 130, y: 210, width: 300, height: 22)
        contentView.addSubview(fullscreenCheckbox)

        autoCloseCheckbox = NSButton(checkboxWithTitle: "Close app when playback ends", target: nil, action: nil)
        autoCloseCheckbox.frame = NSRect(x: 130, y: 184, width: 300, height: 22)
        contentView.addSubview(autoCloseCheckbox)

        headlessCheckbox = NSButton(checkboxWithTitle: "Headless mode (log to file, suppress output)", target: nil, action: nil)
        headlessCheckbox.frame = NSRect(x: 130, y: 158, width: 300, height: 22)
        contentView.addSubview(headlessCheckbox)

        autoSkipIntrosCheckbox = NSButton(checkboxWithTitle: "Auto-skip intros and outros", target: nil, action: nil)
        autoSkipIntrosCheckbox.frame = NSRect(x: 130, y: 132, width: 300, height: 22)
        contentView.addSubview(autoSkipIntrosCheckbox)

        verboseCheckbox = NSButton(checkboxWithTitle: "Verbose logging (debug output)", target: nil, action: nil)
        verboseCheckbox.frame = NSRect(x: 130, y: 106, width: 300, height: 22)
        contentView.addSubview(verboseCheckbox)

        testButton = NSButton(title: "Test Connection", target: self, action: #selector(testConnection))
        testButton.frame = NSRect(x: 130, y: 70, width: 130, height: 32)
        testButton.bezelStyle = .rounded
        contentView.addSubview(testButton)

        statusLabel = NSTextField(labelWithString: "")
        statusLabel.frame = NSRect(x: 270, y: 76, width: 270, height: 20)
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
        launchAtLoginCheckbox.frame = NSRect(x: 130, y: 44, width: 200, height: 22)
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

        let fullscreen = ConfigParser.extractValue(from: content, key: "fullscreen")
        fullscreenCheckbox.state = (fullscreen == "true") ? .on : .off

        let autoClose = ConfigParser.extractValue(from: content, key: "autoClose")
        autoCloseCheckbox.state = (autoClose == "true") ? .on : .off

        let headless = ConfigParser.extractValue(from: content, key: "headless")
        headlessCheckbox.state = (headless == "true") ? .on : .off

        let autoSkipIntros = ConfigParser.extractValue(from: content, key: "autoSkipIntros")
        autoSkipIntrosCheckbox.state = (autoSkipIntros == "true") ? .on : .off

        let verbose = ConfigParser.extractValue(from: content, key: "verbose")
        verboseCheckbox.state = (verbose == "true") ? .on : .off
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

        var lines: [String] = [
            "module.exports = {",
            "    serverUrl: '\(ConfigParser.escapeConfigValue(serverUrlField.stringValue))',",
            "    username: '\(ConfigParser.escapeConfigValue(usernameField.stringValue))',",
            "    password: '\(ConfigParser.escapeConfigValue(passwordField.stringValue))',",
            "    mpvPath: '\(ConfigParser.escapeConfigValue(mpvPathField.stringValue))',",
            "    deviceName: '\(ConfigParser.escapeConfigValue(deviceNameField.stringValue))',",
            "    deviceId: '\(ConfigParser.escapeConfigValue(deviceIdField.stringValue))',",
        ]

        if fullscreenCheckbox.state == .on {
            lines.append("    fullscreen: true,")
        }
        if autoCloseCheckbox.state == .on {
            lines.append("    autoClose: true,")
        }
        if headlessCheckbox.state == .on {
            lines.append("    headless: true,")
        }
        if autoSkipIntrosCheckbox.state == .on {
            lines.append("    autoSkipIntros: true,")
        }
        if verboseCheckbox.state == .on {
            lines.append("    verbose: true,")
        }

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
