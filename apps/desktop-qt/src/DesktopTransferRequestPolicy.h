#pragma once

// Native Desktop downloads may only address authenticated API resources on
// the already selected Cluster Server. Never let a renderer-supplied URL
// cause the privileged cookie-bearing network client to contact another host.
#include <string_view>
#include <cstddef>

namespace cluster::desktop::request {
inline bool sameServerApiPath(std::string_view url) noexcept
{
    if (url.size() < 6 || url.size() > 4096 || !url.starts_with("/api/")
        || url.find('\\') != std::string_view::npos
        || url.find('#') != std::string_view::npos) return false;
    const auto query = url.find('?');
    const auto path = url.substr(0, query);
    if (path.find("//") != std::string_view::npos || path.find("/../") != std::string_view::npos
        || path.find("/./") != std::string_view::npos || path.ends_with("/..")
        || path.ends_with("/.")) return false;
    for (const unsigned char c : url) if (c < 32 || c == 127) return false;
    // Disallow encoded path separators, dots and encoded percent escapes in
    // the path. Avoid path normalization or double-decoding across proxies.
    for (std::size_t i = 0; i < path.size(); ++i) {
        if (path[i] != '%') continue;
        if (i + 2 >= path.size()) return false;
        const auto lowercase = [](char c) { return c >= 'A' && c <= 'Z' ? char(c + ('a' - 'A')) : c; };
        const char a = lowercase(path[i+1]), b = lowercase(path[i+2]);
        if ((a == '2' && (b == 'f' || b == 'e' || b == '5'))
            || (a == '5' && b == 'c')) return false;
    }
    return true;
}
inline bool validUploadId(std::string_view value) noexcept
{
    if (value.size() != 36) return false;
    for (std::size_t i=0;i<value.size();++i) {
        const char c=value[i];
        if (i==8 || i==13 || i==18 || i==23) { if (c!='-') return false; }
        else if (!((c>='0' && c<='9') || (c>='a' && c<='f') || (c>='A' && c<='F'))) return false;
    }
    return true;
}

inline bool projectFileFinalizationPath(std::string_view value) noexcept
{
    constexpr std::string_view prefix="/api/projects/";
    constexpr std::string_view suffix="/files";
    if (!value.starts_with(prefix) || !value.ends_with(suffix)) return false;
    const auto project=value.substr(prefix.size(), value.size()-prefix.size()-suffix.size());
    if (project.empty() || project.size()>80) return false;
    for (char c:project) {
        if (!((c>='0' && c<='9') || (c>='a' && c<='z')
            || (c>='A' && c<='Z') || c=='-' || c=='_')) return false;
    }
    return true;
}

}
