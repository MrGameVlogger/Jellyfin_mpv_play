import Cocoa

class SetupWindowController: NSWindowController, NSWindowDelegate {
    private var stepLabel: NSTextField!
    private var titleLabel: NSTextField!
    private var subtitleLabel: NSTextField!
    private var serverField: NSTextField!
    private var usernameField: NSTextField!
    private var passwordField: NSSecureTextField!
    private var mpvPathField: NSTextField!
    private var deviceNameField: NSTextField!
    private var deviceIdField: NSTextField!
    private var testButton: NSButton!
    private var statusLabel: NSTextField!
    private var nextButton: NSButton!
    private var backButton: NSButton!
    private var skipButton: NSButton!
    private var containerView: NSView!
    private var currentStep = 0
    private var onComplete: (() -> Void)?
    private var didComplete = false

    convenience init(onComplete: @escaping () -> Void) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 420),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Welcome to Jellyfin MPV Play"
        window.center()
        window.isReleasedWhenClosed = false
        self.init(window: window)
        window.delegate = self
        self.onComplete = onComplete
        setupUI()
        showStep(0)
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }

        let icon = NSImage(named: "AppIcon") ?? NSImage(systemSymbolName: "play.circle.fill", accessibilityDescription: nil)
        let iconView = NSImageView(image: icon ?? NSImage())
        iconView.frame = NSRect(x: 230, y: 355, width: 60, height: 60)
        iconView.contentTintColor = .systemOrange
        contentView.addSubview(iconView)

        stepLabel = NSTextField(labelWithString: "")
        stepLabel.frame = NSRect(x: 0, y: 340, width: 520, height: 18)
        stepLabel.alignment = .center
        stepLabel.font = NSFont.systemFont(ofSize: 11)
        stepLabel.textColor = .tertiaryLabelColor
        contentView.addSubview(stepLabel)

        titleLabel = NSTextField(labelWithString: "")
        titleLabel.frame = NSRect(x: 0, y: 310, width: 520, height: 28)
        titleLabel.alignment = .center
        titleLabel.font = NSFont.boldSystemFont(ofSize: 20)
        contentView.addSubview(titleLabel)

        subtitleLabel = NSTextField(labelWithString: "")
        subtitleLabel.frame = NSRect(x: 40, y: 275, width: 440, height: 32)
        subtitleLabel.alignment = .center
        subtitleLabel.font = NSFont.systemFont(ofSize: 13)
        subtitleLabel.textColor = .secondaryLabelColor
        subtitleLabel.maximumNumberOfLines = 2
        contentView.addSubview(subtitleLabel)

        containerView = NSView(frame: NSRect(x: 0, y: 80, width: 520, height: 190))
        contentView.addSubview(containerView)

        backButton = NSButton(title: "Back", target: self, action: #selector(goBack))
        backButton.frame = NSRect(x: 215, y: 20, width: 80, height: 32)
        backButton.bezelStyle = .rounded
        backButton.isHidden = true
        contentView.addSubview(backButton)

        nextButton = NSButton(title: "Continue", target: self, action: #selector(goNext))
        nextButton.frame = NSRect(x: 305, y: 20, width: 100, height: 32)
        nextButton.bezelStyle = .rounded
        nextButton.keyEquivalent = "\r"
        contentView.addSubview(nextButton)

        skipButton = NSButton(title: "Skip Setup", target: self, action: #selector(skip))
        skipButton.frame = NSRect(x: 415, y: 20, width: 90, height: 32)
        skipButton.bezelStyle = .rounded
        contentView.addSubview(skipButton)
    }

    func windowWillClose(_ notification: Notification) {
        if !didComplete {
            // Don't start the shim if setup wasn't completed — config may be missing or incomplete
        }
    }

    private func clearContainer() {
        containerView.subviews.forEach { $0.removeFromSuperview() }
    }

    private func showStep(_ step: Int) {
        currentStep = step
        clearContainer()

        let totalSteps = 5
        stepLabel.stringValue = "Step \(step + 1) of \(totalSteps)"
        backButton.isHidden = step == 0

        switch step {
        case 0: showWelcomeStep()
        case 1: showServerStep()
        case 2: showCredentialsStep()
        case 3: showMpvStep()
        case 4: showFinishStep()
        default: break
        }
    }

    private func showWelcomeStep() {
        titleLabel.stringValue = "Welcome!"
        subtitleLabel.stringValue = "This app lets you control MPV from Jellyfin's web interface.\nLet's get you set up in just a few steps."
        nextButton.title = "Get Started"

        let features = [
            ("play.circle", "Play movies and series from Jellyfin"),
            ("arrow.right.circle", "Auto-play next episode"),
            ("clock.arrow.circlepath", "Resume where you left off"),
            ("menubar.rectangle", "Runs from your menu bar")
        ]

        for (i, (icon, text)) in features.enumerated() {
            let y = 145 - i * 36
            let img = NSImage(systemSymbolName: icon, accessibilityDescription: nil)
            let imgView = NSImageView(image: img ?? NSImage())
            imgView.frame = NSRect(x: 100, y: y, width: 24, height: 24)
            imgView.contentTintColor = .systemOrange
            containerView.addSubview(imgView)

            let label = NSTextField(labelWithString: text)
            label.frame = NSRect(x: 135, y: y + 3, width: 300, height: 20)
            label.font = NSFont.systemFont(ofSize: 14)
            containerView.addSubview(label)
        }
    }

    private func showServerStep() {
        titleLabel.stringValue = "Jellyfin Server"
        subtitleLabel.stringValue = "Enter the URL of your Jellyfin server.\nThis is the address you use to access Jellyfin in your browser."
        nextButton.title = "Continue"

        let urlLabel = NSTextField(labelWithString: "Server URL:")
        urlLabel.frame = NSRect(x: 80, y: 140, width: 100, height: 24)
        urlLabel.alignment = .right
        containerView.addSubview(urlLabel)

        serverField = NSTextField(frame: NSRect(x: 190, y: 140, width: 250, height: 24)
)
        serverField.placeholderString = "http://192.168.1.100:8096"
        containerView.addSubview(serverField)

        let helpLabel = NSTextField(labelWithString: "Find this in your browser's address bar when using Jellyfin.\nUsually something like http://192.168.1.x:8096")
        helpLabel.frame = NSRect(x: 190, y: 100, width: 250, height: 36)
        helpLabel.font = NSFont.systemFont(ofSize: 11)
        helpLabel.textColor = .tertiaryLabelColor
        helpLabel.maximumNumberOfLines = 2
        containerView.addSubview(helpLabel)

        serverField.becomeFirstResponder()
    }

    private func showCredentialsStep() {
        titleLabel.stringValue = "Login Credentials"
        subtitleLabel.stringValue = "Enter your Jellyfin username and password."
        nextButton.title = "Continue"

        let userLabel = NSTextField(labelWithString: "Username:")
        userLabel.frame = NSRect(x: 80, y: 150, width: 100, height: 24)
        userLabel.alignment = .right
        containerView.addSubview(userLabel)

        usernameField = NSTextField(frame: NSRect(x: 190, y: 150, width: 250, height: 24))
        containerView.addSubview(usernameField)

        let passLabel = NSTextField(labelWithString: "Password:")
        passLabel.frame = NSRect(x: 80, y: 110, width: 100, height: 24)
        passLabel.alignment = .right
        containerView.addSubview(passLabel)

        passwordField = NSSecureTextField(frame: NSRect(x: 190, y: 110, width: 250, height: 24))
        containerView.addSubview(passwordField)

        testButton = NSButton(title: "Test Connection", target: self, action: #selector(testConnection))
        testButton.frame = NSRect(x: 190, y: 70, width: 130, height: 28)
        testButton.bezelStyle = .rounded
        containerView.addSubview(testButton)

        statusLabel = NSTextField(labelWithString: "")
        statusLabel.frame = NSRect(x: 330, y: 70, width: 170, height: 28)
        statusLabel.font = NSFont.systemFont(ofSize: 12)
        containerView.addSubview(statusLabel)

        usernameField.becomeFirstResponder()
    }

    private func showMpvStep() {
        titleLabel.stringValue = "MPV Player"
        subtitleLabel.stringValue = "Path to the MPV player on your system."
        nextButton.title = "Continue"

        let pathLabel = NSTextField(labelWithString: "MPV Path:")
        pathLabel.frame = NSRect(x: 80, y: 150, width: 100, height: 24)
        pathLabel.alignment = .right
        containerView.addSubview(pathLabel)

        var sysinfo = utsname()
        uname(&sysinfo)
        let machine = String(bytes: Data(bytes: &sysinfo.machine, count: Int(_SYS_NAMELEN)), encoding: .utf8) ?? ""
        let defaultMpvPath = machine.contains("arm64") ? "/opt/homebrew/bin/mpv" : "/usr/local/bin/mpv"

        // Preserve user edits across back-navigation
        let savedMpvPath = mpvPathField?.stringValue ?? ""
        let savedDeviceName = deviceNameField?.stringValue ?? ""
        let savedDeviceId = deviceIdField?.stringValue ?? ""

        mpvPathField = NSTextField(frame: NSRect(x: 190, y: 150, width: 220, height: 24))
        mpvPathField.stringValue = savedMpvPath.isEmpty ? defaultMpvPath : savedMpvPath
        containerView.addSubview(mpvPathField)

        let browseButton = NSButton(title: "Browse...", target: self, action: #selector(browseMpv))
        browseButton.frame = NSRect(x: 420, y: 150, width: 80, height: 24)
        browseButton.bezelStyle = .rounded
        containerView.addSubview(browseButton)

        let deviceNameLabel = NSTextField(labelWithString: "Device Name:")
        deviceNameLabel.frame = NSRect(x: 80, y: 110, width: 100, height: 24)
        deviceNameLabel.alignment = .right
        containerView.addSubview(deviceNameLabel)

        deviceNameField = NSTextField(frame: NSRect(x: 190, y: 110, width: 250, height: 24))
        deviceNameField.stringValue = savedDeviceName.isEmpty ? "Mac" : savedDeviceName
        containerView.addSubview(deviceNameField)

        let deviceIdLabel = NSTextField(labelWithString: "Device ID:")
        deviceIdLabel.frame = NSRect(x: 80, y: 70, width: 100, height: 24)
        deviceIdLabel.alignment = .right
        containerView.addSubview(deviceIdLabel)

        deviceIdField = NSTextField(frame: NSRect(x: 190, y: 70, width: 250, height: 24))
        deviceIdField.stringValue = savedDeviceId.isEmpty ? "mac-mpv" : savedDeviceId
        containerView.addSubview(deviceIdField)

        let helpLabel = NSTextField(labelWithString: "Device name appears in Jellyfin's device list. Device ID must be unique.")
        helpLabel.frame = NSRect(x: 190, y: 45, width: 300, height: 18)
        helpLabel.font = NSFont.systemFont(ofSize: 11)
        helpLabel.textColor = .tertiaryLabelColor
        containerView.addSubview(helpLabel)
    }

    private func showFinishStep() {
        titleLabel.stringValue = "You're All Set!"
        subtitleLabel.stringValue = "The app will now connect to your Jellyfin server.\nYou can change these settings anytime from the menu."
        nextButton.title = "Start"
        nextButton.keyEquivalent = "\r"

        let tips = [
            ("The app runs from your menu bar (top right)", "menubar.rectangle"),
            ("Open Jellyfin in your browser and use 'Play on' to start watching", "play.circle"),
            ("Use Preferences to update settings later", "gearshape"),
            ("Check the Help menu for tips and troubleshooting", "questionmark.circle")
        ]

        for (i, (text, icon)) in tips.enumerated() {
            let y = 145 - i * 36
            let img = NSImage(systemSymbolName: icon, accessibilityDescription: nil)
            let imgView = NSImageView(image: img ?? NSImage())
            imgView.frame = NSRect(x: 80, y: y, width: 24, height: 24)
            imgView.contentTintColor = .systemGreen
            containerView.addSubview(imgView)

            let label = NSTextField(labelWithString: text)
            label.frame = NSRect(x: 115, y: y + 3, width: 350, height: 20)
            label.font = NSFont.systemFont(ofSize: 13)
            containerView.addSubview(label)
        }
    }

    @objc private func goNext() {
        if currentStep == 1 && serverField.stringValue.isEmpty {
            shakeField(serverField)
            return
        }
        if currentStep == 1 {
            var url = serverField.stringValue.trimmingCharacters(in: .whitespaces)
            url = url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if !url.hasPrefix("http://") && !url.hasPrefix("https://") {
                url = "http://" + url
            }
            serverField.stringValue = url
        }
        if currentStep == 2 && (usernameField.stringValue.isEmpty || passwordField.stringValue.isEmpty) {
            if usernameField.stringValue.isEmpty { shakeField(usernameField) }
            if passwordField.stringValue.isEmpty { shakeField(passwordField) }
            return
        }

        if currentStep < 4 {
            showStep(currentStep + 1)
        } else {
            saveAndFinish()
        }
    }

    @objc private func goBack() {
        if currentStep > 0 {
            showStep(currentStep - 1)
        }
    }

    @objc private func skip() {
        didComplete = true
        onComplete?()
        window?.close()
    }

    @objc private func browseMpv() {
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
        let server = serverField.stringValue
        let user = usernameField.stringValue
        let pass = passwordField.stringValue

        guard !server.isEmpty, !user.isEmpty, !pass.isEmpty else {
            statusLabel.stringValue = "Fill in all fields"
            statusLabel.textColor = .systemYellow
            return
        }

        testButton.isEnabled = false
        statusLabel.stringValue = "Testing..."
        statusLabel.textColor = .labelColor

        ConfigParser.testConnection(server: server, username: user, password: pass, deviceId: "setup-test", deviceName: "Setup") { [weak self] success, message in
            self?.testButton.isEnabled = true
            self?.statusLabel.stringValue = message
            self?.statusLabel.textColor = success ? .systemGreen : .systemRed
        }
    }

    private func saveAndFinish() {
        let server = serverField?.stringValue ?? ""
        let user = usernameField?.stringValue ?? ""
        let pass = passwordField?.stringValue ?? ""
        let mpv = mpvPathField?.stringValue ?? "/opt/homebrew/bin/mpv"
        let name = deviceNameField?.stringValue ?? "Mac"
        let id = deviceIdField?.stringValue ?? "mac-mpv"

        let config = """
        module.exports = {
            serverUrl: '\(ConfigParser.escapeConfigValue(server))',
            username: '\(ConfigParser.escapeConfigValue(user))',
            password: '\(ConfigParser.escapeConfigValue(pass))',
            mpvPath: '\(ConfigParser.escapeConfigValue(mpv))',
            deviceName: '\(ConfigParser.escapeConfigValue(name))',
            deviceId: '\(ConfigParser.escapeConfigValue(id))'
        };
        """

        let configPath = ConfigParser.configPath()

        do {
            let configDir = (configPath as NSString).deletingLastPathComponent
            try FileManager.default.createDirectory(atPath: configDir, withIntermediateDirectories: true)
            let dedented = config.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")
            try dedented.write(toFile: configPath, atomically: true, encoding: .utf8)
            didComplete = true
            onComplete?()
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

    private func shakeField(_ field: NSTextField) {
        field.wantsLayer = true
        let position = field.layer?.position ?? NSPoint(x: field.frame.midX, y: field.frame.midY)
        let shake = CAKeyframeAnimation(keyPath: "position")
        shake.values = [
            NSValue(point: position),
            NSValue(point: NSPoint(x: position.x - 8, y: position.y)),
            NSValue(point: NSPoint(x: position.x + 8, y: position.y)),
            NSValue(point: NSPoint(x: position.x - 4, y: position.y)),
            NSValue(point: NSPoint(x: position.x + 4, y: position.y)),
            NSValue(point: position)
        ]
        shake.duration = 0.4
        field.layer?.add(shake, forKey: "position")
    }
}
