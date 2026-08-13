import Foundation

enum ConfigParser {
    static func extractValue(from content: String, key: String) -> String {
        let escapedKey = NSRegularExpression.escapedPattern(for: key)
        let pattern = "\(escapedKey):\\s*['\"]([^'\"]*)['\"]"
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
              let range = Range(match.range(at: 1), in: content) else {
            return ""
        }
        return unescapeConfigValue(String(content[range]))
    }

    private static func unescapeConfigValue(_ value: String) -> String {
        var result = value
        result = result.replacingOccurrences(of: "\\\\", with: "\u{0000}")
        result = result.replacingOccurrences(of: "\\'", with: "'")
        result = result.replacingOccurrences(of: "\\\"", with: "\"")
        result = result.replacingOccurrences(of: "\\n", with: "\n")
        result = result.replacingOccurrences(of: "\\r", with: "\r")
        result = result.replacingOccurrences(of: "\\t", with: "\t")
        result = result.replacingOccurrences(of: "\u{0000}", with: "\\")
        return result
    }

    static func applicationSupportDir() -> String {
        let paths = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
        guard let appSupport = paths.first else {
            return NSHomeDirectory() + "/Library/Application Support/JellyfinMpvPlay"
        }
        return appSupport.appendingPathComponent("JellyfinMpvPlay").path
    }

    static func configPath() -> String {
        return applicationSupportDir() + "/config.js"
    }

    static func loadConfigContent() -> String? {
        return try? String(contentsOfFile: configPath(), encoding: .utf8)
    }
}
