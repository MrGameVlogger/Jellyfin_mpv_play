import Cocoa

class LogWindowController: NSWindowController {
    private var textView: NSTextView!
    private var scrollView: NSScrollView!
    private var autoScroll = true
    private var autoScrollButton: NSButton!
    private var lineCount = 0

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 700, height: 500),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Jellyfin MPV Play - Logs"
        window.center()
        window.minSize = NSSize(width: 400, height: 300)
        window.isReleasedWhenClosed = false
        self.init(window: window)
        setupUI()
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }

        let clearButton = NSButton(title: "Clear", target: self, action: #selector(clearLog))
        clearButton.frame = NSRect(x: 10, y: 10, width: 70, height: 28)
        clearButton.bezelStyle = .rounded
        contentView.addSubview(clearButton)

        autoScrollButton = NSButton(title: "Auto-scroll: On", target: self, action: #selector(toggleAutoScroll))
        autoScrollButton.frame = NSRect(x: 90, y: 10, width: 120, height: 28)
        autoScrollButton.bezelStyle = .rounded
        contentView.addSubview(autoScrollButton)

        let exportButton = NSButton(title: "Export", target: self, action: #selector(exportLogs))
        exportButton.frame = NSRect(x: 220, y: 10, width: 70, height: 28)
        exportButton.bezelStyle = .rounded
        contentView.addSubview(exportButton)

        scrollView = NSScrollView(frame: NSRect(x: 0, y: 44, width: contentView.bounds.width, height: contentView.bounds.height - 44))
        scrollView.autoresizingMask = [.width, .height]
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true

        textView = NSTextView(frame: NSRect(origin: .zero, size: scrollView.contentSize))
        textView.isEditable = false
        textView.isSelectable = true
        textView.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.backgroundColor = .textBackgroundColor
        textView.textColor = .textColor
        textView.insertionPointColor = .textColor
        textView.textContainerInset = NSSize(width: 10, height: 10)

        scrollView.documentView = textView
        contentView.addSubview(scrollView)
    }

    func appendLog(_ line: String) {
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        let attributedString = NSAttributedString(
            string: "[\(timestamp)] \(line)\n",
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
                .foregroundColor: colorForLine(line)
            ]
        )
        textView.textStorage?.append(attributedString)
        lineCount += 1

        if autoScroll {
            textView.scrollRangeToVisible(NSRange(location: (textView.string as NSString).length, length: 0))
        }

        if lineCount > 1000 {
            let nsString = textView.string as NSString
            let halfLength = nsString.length / 2
            let range = nsString.range(of: "\n", options: [], range: NSRange(location: 0, length: halfLength))
            if range.location != NSNotFound {
                let deletedText = nsString.substring(to: range.location + 1)
                let deletedLines = deletedText.components(separatedBy: "\n").count - 1
                textView.textStorage?.deleteCharacters(in: NSRange(location: 0, length: range.location + 1))
                lineCount -= deletedLines
            }
        }
    }

    private func colorForLine(_ line: String) -> NSColor {
        if line.hasPrefix("ERROR") || line.contains("STDERR") || line.contains("FATAL") {
            return .systemRed
        } else if line.contains("WARNING") || line.contains("WARN") || line.contains("warn") {
            return .systemYellow
        } else if line.contains("Connected") || line.contains("connection established") {
            return .systemGreen
        } else if line.contains("Playing") || line.contains("Episode detected") || line.contains("file-loaded") {
            return .systemOrange
        }
        return .labelColor
    }

    @objc private func clearLog() {
        textView.string = ""
        lineCount = 0
    }

    @objc private func toggleAutoScroll() {
        autoScroll.toggle()
        autoScrollButton.title = autoScroll ? "Auto-scroll: On" : "Auto-scroll: Off"
        if autoScroll {
            textView.scrollRangeToVisible(NSRange(location: (textView.string as NSString).length, length: 0))
        }
    }

    @objc private func exportLogs() {
        let panel = NSSavePanel()
        panel.title = "Export Logs"
        let formatter = ISO8601DateFormatter()
        panel.nameFieldStringValue = "jellyfin-mpv-play-\(formatter.string(from: Date())).log"
        panel.allowedContentTypes = [.log]
        panel.begin { [weak self] response in
            if response == .OK, let url = panel.url {
                do {
                    try self?.textView.string.write(to: url, atomically: true, encoding: .utf8)
                } catch {
                    let alert = NSAlert()
                    alert.messageText = "Failed to export logs"
                    alert.informativeText = error.localizedDescription
                    alert.alertStyle = .warning
                    alert.addButton(withTitle: "OK")
                    alert.runModal()
                }
            }
        }
    }
}
