import Cocoa

class HelpWindowController: NSWindowController {
    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 480),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Help"
        window.center()
        window.isReleasedWhenClosed = false

        self.init(window: window)
        setupUI()
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }

        let scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: 520, height: 480))
        scrollView.hasVerticalScroller = true
        scrollView.autoresizingMask = [.width, .height]

        let contentSize = scrollView.contentSize
        let containerView = NSView(frame: NSRect(x: 0, y: 0, width: contentSize.width, height: 700))

        var y: CGFloat = 660

        func addSection(_ title: String) {
            let label = NSTextField(labelWithString: title)
            label.frame = NSRect(x: 20, y: y, width: 480, height: 24)
            label.font = NSFont.boldSystemFont(ofSize: 15)
            containerView.addSubview(label)
            y -= 30
        }

        func addText(_ text: String, indent: CGFloat = 0) {
            let label = NSTextField(labelWithString: text)
            label.frame = NSRect(x: 20 + indent, y: y, width: 480 - indent, height: 20)
            label.font = NSFont.systemFont(ofSize: 13)
            label.textColor = .labelColor
            containerView.addSubview(label)
            y -= 22
        }

        func addSpace() {
            y -= 12
        }

        // Getting Started
        addSection("Getting Started")
        addText("1. Open Jellyfin in your web browser")
        addText("2. Find a movie or TV episode to play")
        addText("3. Click the cast icon (Play on) and select 'Jellyfin MPV Play'")
        addText("4. MPV will open and start playing automatically")
        addSpace()
        addText("The app runs from your menu bar. Click the play icon to see status and controls.")
        addSpace()

        // Menu Bar
        addSection("Menu Bar Controls")
        addText("Pause / Resume — Pause or resume playback")
        addText("Stop — Stop playback and close MPV")
        addText("Show Logs — View connection and playback logs")
        addText("Preferences — Update server, credentials, or MPV path")
        addText("Help — This help window")
        addText("About — App version and info")
        addText("Restart — Restart the connection to Jellyfin")
        addText("Quit — Exit the app")
        addSpace()

        // Keyboard Shortcuts
        addSection("Keyboard Shortcuts (in MPV)")
        addText(" >  or  Media Next — Next episode")
        addText(" <  or  Media Previous — Previous episode")
        addSpace()

        // Smart Resume
        addSection("Smart Resume")
        addText("The app remembers where you left off. When you play something again,")
        addText("it resumes from your last position.")
        addText("Use 'Play from beginning' in Jellyfin to start fresh instead.")
        addSpace()

        // Troubleshooting
        addSection("Troubleshooting")
        addText("MPV doesn't open:", indent: 0)
        addText("Check that mpvPath is correct in Preferences. Run 'mpv --version' in Terminal to verify.", indent: 10)
        addSpace()
        addText("Device doesn't appear in Jellyfin:", indent: 0)
        addText("Verify server URL, username, and password are correct.", indent: 10)
        addSpace()
        addText("Black screen or no video:", indent: 0)
        addText("Check ~/.config/mpv/mpv.conf has valid 'vo' and 'hwdec' settings.", indent: 10)
        addSpace()
        addText("Episode navigation not working:", indent: 0)
        addText("Custom keybinds in ~/.config/mpv/input.conf may override defaults.", indent: 10)
        addSpace()

        // Links
        addSection("More Info")
        addText("GitHub: github.com/MrGameVlogger/Jellyfin_mpv_play")
        addText("Upstream: github.com/JohnGlaus/Jellyfin_mpv_play")
        addText("MPV: mpv.io")
        addText("Jellyfin: jellyfin.org")

        scrollView.documentView = containerView
        contentView.addSubview(scrollView)
    }
}
