import Cocoa

class HelpWindowController: NSWindowController {
    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 520),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Help"
        window.center()
        window.minSize = NSSize(width: 400, height: 300)
        window.isReleasedWhenClosed = false
        self.init(window: window)
        setupUI()
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }

        let scrollView = NSScrollView(frame: contentView.bounds)
        scrollView.autoresizingMask = [.width, .height]
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false

        let containerWidth = scrollView.contentView.bounds.width
        let containerView = NSView(frame: NSRect(x: 0, y: 0, width: containerWidth, height: 1100))

        var y: CGFloat = 1060

        func addDivider() {
            let line = NSBox()
            line.boxType = .separator
            line.frame = NSRect(x: 24, y: y + 4, width: containerWidth - 48, height: 1)
            containerView.addSubview(line)
            y -= 16
        }

        func addSection(_ title: String, icon: String? = nil) {
            y -= 8
            if let icon = icon {
                let img = NSImage(systemSymbolName: icon, accessibilityDescription: nil)
                let imgView = NSImageView(image: img ?? NSImage())
                imgView.frame = NSRect(x: 24, y: y - 2, width: 18, height: 18)
                imgView.contentTintColor = .systemOrange
                containerView.addSubview(imgView)

                let label = NSTextField(labelWithString: title)
                label.frame = NSRect(x: 50, y: y, width: 400, height: 22)
                label.font = NSFont.boldSystemFont(ofSize: 15)
                containerView.addSubview(label)
            } else {
                let label = NSTextField(labelWithString: title)
                label.frame = NSRect(x: 24, y: y, width: 400, height: 22)
                label.font = NSFont.boldSystemFont(ofSize: 15)
                containerView.addSubview(label)
            }
            y -= 28
        }

        func addText(_ text: String, bold: Bool = false, color: NSColor = .labelColor, indent: CGFloat = 0) {
            let label = NSTextField(labelWithString: text)
            label.frame = NSRect(x: 24 + indent, y: y, width: containerWidth - 48 - indent, height: 18)
            label.font = bold ? NSFont.boldSystemFont(ofSize: 13) : NSFont.systemFont(ofSize: 13)
            label.textColor = color
            containerView.addSubview(label)
            y -= 20
        }

        func addKeybind(_ key: String, _ description: String) {
            let keyLabel = NSTextField(labelWithString: key)
            keyLabel.frame = NSRect(x: 40, y: y, width: 140, height: 18)
            keyLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)
            keyLabel.textColor = .secondaryLabelColor
            containerView.addSubview(keyLabel)

            let descLabel = NSTextField(labelWithString: description)
            descLabel.frame = NSRect(x: 190, y: y, width: containerWidth - 240, height: 18)
            descLabel.font = NSFont.systemFont(ofSize: 13)
            containerView.addSubview(descLabel)
            y -= 22
        }

        func addLink(_ text: String, url: String) {
            let button = NSButton(title: text, target: self, action: #selector(openLink(_:)))
            button.frame = NSRect(x: 24, y: y, width: containerWidth - 48, height: 18)
            button.bezelStyle = .inline
            button.isBordered = false
            button.contentTintColor = .systemBlue
            button.font = NSFont.systemFont(ofSize: 13)
            button.identifier = NSUserInterfaceItemIdentifier(url)
            containerView.addSubview(button)
            y -= 20
        }

        func addSpacing(_ height: CGFloat = 12) {
            y -= height
        }

        // ── Getting Started ──
        addSection("Getting Started", icon: "play.circle")
        addText("1. Open Jellyfin in your web browser")
        addText("2. Find a movie or TV episode to play")
        addText("3. Click the cast icon (Play on) and select 'Jellyfin MPV Play'")
        addText("4. MPV opens and starts playing automatically")
        addSpacing()
        addText("The app runs from your menu bar. Click the play icon for controls.", color: .secondaryLabelColor)
        addSpacing()
        addDivider()

        // ── Menu Bar ──
        addSection("Menu Bar Controls", icon: "menubar.arrow.up.rectangle")
        addText("Click the menu bar icon to access these shortcuts:", color: .secondaryLabelColor)
        addSpacing(4)
        addKeybind("⌘P", "Pause / Resume playback")
        addKeybind("⌘.", "Stop playback and close MPV")
        addKeybind("⌘L", "Show Logs")
        addKeybind("⌘,", "Preferences")
        addKeybind("⌘/", "Help")
        addKeybind("⌘I", "About")
        addKeybind("⌘R", "Restart connection")
        addKeybind("⌘Q", "Quit")
        addSpacing()
        addDivider()

        // ── Keyboard Shortcuts ──
        addSection("Keyboard Shortcuts (in MPV)", icon: "keyboard")
        addKeybind(">", "Next episode")
        addKeybind("<", "Previous episode")
        addKeybind("Media Next", "Next episode (media key)")
        addKeybind("Media Previous", "Previous episode (media key)")
        addSpacing()
        addDivider()

        // ── Smart Resume ──
        addSection("Smart Resume", icon: "clock.arrow.circlepath")
        addText("The app remembers where you left off. When you play something again,")
        addText("it resumes from your last position automatically.")
        addSpacing(4)
        addText("Use 'Play from beginning' in Jellyfin to start fresh instead.", color: .secondaryLabelColor)
        addSpacing()
        addDivider()

        // ── Troubleshooting ──
        addSection("Troubleshooting", icon: "wrench.and.screwdriver")
        addText("MPV doesn't open:", bold: true)
        addText("Check that mpvPath is correct in Preferences. Run 'mpv --version' in Terminal to verify.", indent: 12)
        addSpacing(8)
        addText("Device doesn't appear in Jellyfin:", bold: true)
        addText("Verify server URL, username, and password are correct.", indent: 12)
        addSpacing(8)
        addText("Black screen or no video:", bold: true)
        addText("Check ~/.config/mpv/mpv.conf for valid 'vo' and 'hwdec' settings.", indent: 12)
        addSpacing(8)
        addText("Episode navigation (>/<) not working:", bold: true)
        addText("Custom keybinds in ~/.config/mpv/input.conf may override defaults.", indent: 12)
        addSpacing()
        addDivider()

        // ── Links ──
        addSection("More Info", icon: "link")
        addLink("GitHub: github.com/MrGameVlogger/Jellyfin_mpv_play", url: "https://github.com/MrGameVlogger/Jellyfin_mpv_play")
        addLink("Upstream: github.com/JohnGlaus/Jellyfin_mpv_play", url: "https://github.com/JohnGlaus/Jellyfin_mpv_play")
        addLink("MPV: mpv.io", url: "https://mpv.io")
        addLink("Jellyfin: jellyfin.org", url: "https://jellyfin.org")
        addSpacing(20)

        scrollView.documentView = containerView
        contentView.addSubview(scrollView)
    }

    @objc private func openLink(_ sender: NSButton) {
        if let urlString = sender.identifier?.rawValue, let url = URL(string: urlString) {
            NSWorkspace.shared.open(url)
        }
    }
}
