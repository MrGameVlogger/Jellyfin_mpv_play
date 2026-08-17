import Foundation

enum ConfigParser {
    static func extractValue(from content: String, key: String) -> String {
        let escapedKey = NSRegularExpression.escapedPattern(for: key)
        // Match: key: 'value' or key: "value" (quoted strings)
        let quotedPattern = "\(escapedKey):\\s*(['\"])([^'\"]*(?:\\\\.[^'\"]*)*)\\1"
        if let regex = try? NSRegularExpression(pattern: quotedPattern),
           let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
           let range = Range(match.range(at: 2), in: content) {
            return unescapeConfigValue(String(content[range]))
        }
        // Match: key: true/false (booleans)
        let boolPattern = "\(escapedKey):\\s*(true|false)"
        if let regex = try? NSRegularExpression(pattern: boolPattern),
           let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
           let range = Range(match.range(at: 1), in: content) {
            return String(content[range])
        }
        // Match: key: 123 (numbers)
        let numberPattern = "\(escapedKey):\\s*(\\d+)"
        if let regex = try? NSRegularExpression(pattern: numberPattern),
           let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
           let range = Range(match.range(at: 1), in: content) {
            return String(content[range])
        }
        return ""
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

    static func escapeConfigValue(_ s: String) -> String {
        return s
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\t", with: "\\t")
    }

    static func testConnection(server: String, username: String, password: String, deviceId: String = "test", deviceName: String = "Jellyfin MPV Play", completion: @escaping (Bool, String) -> Void) {
        let trimmedServer = server.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !trimmedServer.isEmpty, !username.isEmpty, !password.isEmpty else {
            completion(false, "Fill in all fields")
            return
        }

        guard let url = URL(string: "\(trimmedServer)/Users/AuthenticateByName"),
              let scheme = url.scheme?.lowercased(),
              (scheme == "http" || scheme == "https") else {
            completion(false, "Invalid URL (use http:// or https://)")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let authHeader = "MediaBrowser Client=\"Jellyfin MPV Play\", Device=\"\(deviceName)\", DeviceId=\"\(deviceId)\", Version=\"\(version)\""
        request.addValue(authHeader, forHTTPHeaderField: "X-Emby-Authorization")
        let body: [String: Any] = ["Username": username, "Pw": password]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    completion(false, "Failed: \(error.localizedDescription)")
                    return
                }
                guard let httpResponse = response as? HTTPURLResponse else {
                    completion(false, "Invalid response")
                    return
                }
                if httpResponse.statusCode == 200 {
                    completion(true, "Connected!")
                } else {
                    completion(false, "Failed: HTTP \(httpResponse.statusCode)")
                }
            }
        }.resume()
    }
}
