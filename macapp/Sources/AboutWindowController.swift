import Cocoa

class AboutWindowController: NSWindowController {
    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 320),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "About Jellyfin MPV Play"
        window.center()
        window.isReleasedWhenClosed = false

        self.init(window: window)
        setupUI()
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }

        let icon = NSImage(systemSymbolName: "play.circle.fill", accessibilityDescription: "App Icon")
        let iconView = NSImageView(image: icon ?? NSImage())
        iconView.frame = NSRect(x: 180, y: 245, width: 60, height: 60)
        iconView.contentTintColor = .systemOrange
        contentView.addSubview(iconView)

        let title = NSTextField(labelWithString: "Jellyfin MPV Play")
        title.frame = NSRect(x: 0, y: 215, width: 420, height: 28)
        title.alignment = .center
        title.font = NSFont.boldSystemFont(ofSize: 20)
        contentView.addSubview(title)

        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.3.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        let versionLabel = NSTextField(labelWithString: "Version \(version) (build \(build))")
        versionLabel.frame = NSRect(x: 0, y: 193, width: 420, height: 18)
        versionLabel.alignment = .center
        versionLabel.font = NSFont.systemFont(ofSize: 13)
        versionLabel.textColor = .secondaryLabelColor
        contentView.addSubview(versionLabel)

        let separator = NSBox()
        separator.boxType = .separator
        separator.frame = NSRect(x: 40, y: 183, width: 340, height: 1)
        contentView.addSubview(separator)

        let desc = NSTextField(labelWithString: "Control MPV from Jellyfin's web interface.\nPlay movies and series with hardware acceleration,\nauto-resume, and auto-play next episode.")
        desc.frame = NSRect(x: 30, y: 130, width: 360, height: 48)
        desc.alignment = .center
        desc.font = NSFont.systemFont(ofSize: 12)
        desc.textColor = .secondaryLabelColor
        desc.maximumNumberOfLines = 3
        contentView.addSubview(desc)

        let features = "Native macOS menubar app  •  Bundled Node.js  •  Smart Resume"
        let featuresLabel = NSTextField(labelWithString: features)
        featuresLabel.frame = NSRect(x: 30, y: 110, width: 360, height: 18)
        featuresLabel.alignment = .center
        featuresLabel.font = NSFont.systemFont(ofSize: 11)
        featuresLabel.textColor = .tertiaryLabelColor
        contentView.addSubview(featuresLabel)

        let forkLabel = NSTextField(labelWithString: "Fork of JohnGlaus/Jellyfin_mpv_play")
        forkLabel.frame = NSRect(x: 0, y: 85, width: 420, height: 16)
        forkLabel.alignment = .center
        forkLabel.font = NSFont.systemFont(ofSize: 11)
        forkLabel.textColor = .tertiaryLabelColor
        contentView.addSubview(forkLabel)

        let linkButton = NSButton(title: "GitHub", target: self, action: #selector(openGitHub))
        linkButton.frame = NSRect(x: 170, y: 55, width: 80, height: 24)
        linkButton.bezelStyle = .inline
        linkButton.isBordered = false
        linkButton.contentTintColor = .systemBlue
        contentView.addSubview(linkButton)

        let mpvButton = NSButton(title: "MPV", target: self, action: #selector(openMpv))
        mpvButton.frame = NSRect(x: 250, y: 55, width: 50, height: 24)
        mpvButton.bezelStyle = .inline
        mpvButton.isBordered = false
        mpvButton.contentTintColor = .systemBlue
        contentView.addSubview(mpvButton)

        let copyright = NSTextField(labelWithString: "MIT License  •  © 2026")
        copyright.frame = NSRect(x: 0, y: 20, width: 420, height: 18)
        copyright.alignment = .center
        copyright.font = NSFont.systemFont(ofSize: 11)
        copyright.textColor = .quaternaryLabelColor
        contentView.addSubview(copyright)
    }

    @objc private func openGitHub() {
        if let url = URL(string: "https://github.com/MrGameVlogger/Jellyfin_mpv_play") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func openMpv() {
        if let url = URL(string: "https://mpv.io") {
            NSWorkspace.shared.open(url)
        }
    }
}
