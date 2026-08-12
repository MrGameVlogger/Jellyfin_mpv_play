import Cocoa

class AboutWindowController: NSWindowController {
    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 350),
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

        let iconView = NSImageView(frame: NSRect(x: 180, y: 275, width: 60, height: 60))
        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconView.image = NSImage(named: "AppIcon")
        contentView.addSubview(iconView)

        let title = NSTextField(labelWithString: "Jellyfin MPV Play")
        title.frame = NSRect(x: 0, y: 245, width: 420, height: 28)
        title.alignment = .center
        title.font = NSFont.boldSystemFont(ofSize: 20)
        contentView.addSubview(title)

        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.3.1"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        let versionLabel = NSTextField(labelWithString: "Version \(version) (build \(build))")
        versionLabel.frame = NSRect(x: 0, y: 223, width: 420, height: 18)
        versionLabel.alignment = .center
        versionLabel.font = NSFont.systemFont(ofSize: 13)
        versionLabel.textColor = .secondaryLabelColor
        contentView.addSubview(versionLabel)

        let separator = NSBox()
        separator.boxType = .separator
        separator.frame = NSRect(x: 40, y: 210, width: 340, height: 1)
        contentView.addSubview(separator)

        let desc = NSTextField(labelWithString: "Control MPV from Jellyfin's web interface.\nPlay movies and series with hardware acceleration,\nauto-resume, and auto-play next episode.")
        desc.frame = NSRect(x: 30, y: 155, width: 360, height: 48)
        desc.alignment = .center
        desc.font = NSFont.systemFont(ofSize: 12)
        desc.textColor = .secondaryLabelColor
        desc.maximumNumberOfLines = 3
        contentView.addSubview(desc)

        let features = "Native macOS menubar app  •  Bundled Node.js  •  Smart Resume"
        let featuresLabel = NSTextField(labelWithString: features)
        featuresLabel.frame = NSRect(x: 30, y: 135, width: 360, height: 18)
        featuresLabel.alignment = .center
        featuresLabel.font = NSFont.systemFont(ofSize: 11)
        featuresLabel.textColor = .tertiaryLabelColor
        contentView.addSubview(featuresLabel)

        let forkLabel = NSTextField(labelWithString: "Fork of JohnGlaus/Jellyfin_mpv_play")
        forkLabel.frame = NSRect(x: 0, y: 108, width: 420, height: 16)
        forkLabel.alignment = .center
        forkLabel.font = NSFont.systemFont(ofSize: 11)
        forkLabel.textColor = .tertiaryLabelColor
        contentView.addSubview(forkLabel)

        let linkButton = NSButton(title: "GitHub", target: self, action: #selector(openGitHub))
        linkButton.frame = NSRect(x: 120, y: 75, width: 70, height: 24)
        linkButton.bezelStyle = .inline
        linkButton.isBordered = false
        linkButton.contentTintColor = .systemBlue
        contentView.addSubview(linkButton)

        let jellyfinButton = NSButton(title: "Jellyfin", target: self, action: #selector(openJellyfin))
        jellyfinButton.frame = NSRect(x: 190, y: 75, width: 70, height: 24)
        jellyfinButton.bezelStyle = .inline
        jellyfinButton.isBordered = false
        jellyfinButton.contentTintColor = .systemBlue
        contentView.addSubview(jellyfinButton)

        let mpvButton = NSButton(title: "MPV", target: self, action: #selector(openMpv))
        mpvButton.frame = NSRect(x: 260, y: 75, width: 50, height: 24)
        mpvButton.bezelStyle = .inline
        mpvButton.isBordered = false
        mpvButton.contentTintColor = .systemBlue
        contentView.addSubview(mpvButton)

        let separator2 = NSBox()
        separator2.boxType = .separator
        separator2.frame = NSRect(x: 40, y: 62, width: 340, height: 1)
        contentView.addSubview(separator2)

        let copyright = NSTextField(labelWithString: "MIT License  •  © 2026")
        copyright.frame = NSRect(x: 0, y: 35, width: 420, height: 18)
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

    @objc private func openJellyfin() {
        if let url = URL(string: "https://jellyfin.org") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func openMpv() {
        if let url = URL(string: "https://mpv.io") {
            NSWorkspace.shared.open(url)
        }
    }
}
