import Cocoa

class AboutWindowController: NSWindowController {
    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 240),
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
        iconView.frame = NSRect(x: 150, y: 170, width: 60, height: 60)
        iconView.contentTintColor = .systemOrange
        contentView.addSubview(iconView)

        let title = NSTextField(labelWithString: "Jellyfin MPV Play")
        title.frame = NSRect(x: 0, y: 135, width: 360, height: 28)
        title.alignment = .center
        title.font = NSFont.boldSystemFont(ofSize: 20)
        contentView.addSubview(title)

        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        let versionLabel = NSTextField(labelWithString: "Version \(version) (build \(build))")
        versionLabel.frame = NSRect(x: 0, y: 110, width: 360, height: 20)
        versionLabel.alignment = .center
        versionLabel.font = NSFont.systemFont(ofSize: 13)
        versionLabel.textColor = .secondaryLabelColor
        contentView.addSubview(versionLabel)

        let desc = NSTextField(labelWithString: "Control MPV from Jellyfin's web interface.\nPlay movies and series with hardware acceleration\nand resume from where you left off.")
        desc.frame = NSRect(x: 30, y: 55, width: 300, height: 50)
        desc.alignment = .center
        desc.font = NSFont.systemFont(ofSize: 12)
        desc.textColor = .tertiaryLabelColor
        desc.maximumNumberOfLines = 3
        contentView.addSubview(desc)

        let copyright = NSTextField(labelWithString: "© 2026 Jellyfin MPV Play")
        copyright.frame = NSRect(x: 0, y: 20, width: 360, height: 18)
        copyright.alignment = .center
        copyright.font = NSFont.systemFont(ofSize: 11)
        copyright.textColor = .quaternaryLabelColor
        contentView.addSubview(copyright)
    }
}
