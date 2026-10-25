#pragma once

// A Qt-independent response admission policy. Keep this small enough to test
// with a normal C++20 compiler on a non-Windows build worker. A 206 response
// is never permission to append unless its exact requested start, known total,
// generation validator and advertised body length all agree.
#include <charconv>
#include <cstdint>
#include <limits>
#include <string_view>

namespace cluster::desktop::download {
enum class Reject {
    none,
    invalidStatus,
    ignoredResume,
    changedGeneration,
    invalidLength,
    invalidRange,
    mismatchedRange,
    missingTotal,
    fragmentTooSmall,
};

struct Admission {
    Reject rejection = Reject::invalidStatus;
    std::int64_t total = -1;
    std::int64_t bodyLength = -1;
    bool accepted() const { return rejection == Reject::none; }
};

inline bool parsePositiveDecimal(std::string_view text, std::int64_t &output, bool allowZero = false)
{
    if (text.empty()) return false;
    std::int64_t parsed = 0;
    const auto *begin = text.data();
    const auto *end = begin + text.size();
    const auto result = std::from_chars(begin, end, parsed, 10);
    if (result.ec != std::errc{} || result.ptr != end || parsed < 0 || (!allowZero && parsed == 0)) return false;
    output = parsed;
    return true;
}

inline Admission admit(int status, std::int64_t offset, std::int64_t knownTotal,
                       std::string_view contentRange, std::string_view contentLength,
                       std::string_view responseEtag, std::string_view previousEtag)
{
    if (offset < 0 || knownTotal < 0) return { Reject::invalidRange };
    if (status != 200 && status != 206) return { Reject::invalidStatus };
    if (offset > 0 && status != 206) return { Reject::ignoredResume };
    if (!previousEtag.empty() && offset > 0 && responseEtag != previousEtag)
        return { Reject::changedGeneration };

    std::int64_t advertisedLength = -1;
    if (!contentLength.empty() && !parsePositiveDecimal(contentLength, advertisedLength))
        return { Reject::invalidLength };
    std::int64_t total = -1;
    std::int64_t length = advertisedLength;
    if (status == 206) {
        constexpr std::string_view prefix = "bytes ";
        if (!contentRange.starts_with(prefix)) return { Reject::invalidRange };
        const auto value = contentRange.substr(prefix.size());
        const auto dash = value.find('-');
        const auto slash = value.find('/');
        if (dash == std::string_view::npos || slash == std::string_view::npos || dash == 0
            || slash <= dash + 1 || slash + 1 >= value.size() || value.find('/', slash + 1) != std::string_view::npos)
            return { Reject::invalidRange };
        std::int64_t start = -1, end = -1;
        if (!parsePositiveDecimal(value.substr(0, dash), start, true)
            || !parsePositiveDecimal(value.substr(dash + 1, slash - dash - 1), end, true)
            || !parsePositiveDecimal(value.substr(slash + 1), total))
            return { Reject::invalidRange };
        if (start != offset || end < start || end >= total || (knownTotal > 0 && knownTotal != total))
            return { Reject::mismatchedRange };
        // end-start+1 cannot overflow when end < total and total is int64.
        length = end - start + 1;
        if (advertisedLength >= 0 && advertisedLength != length)
            return { Reject::invalidLength };
        // Range was open-ended: rejecting pathological nonfinal fragments
        // prevents a broken origin from forcing one request per tiny slice.
        // Tiny whole objects and the short final fragment remain valid.
        constexpr std::int64_t minimumProgress = 64 * 1024;
        constexpr std::int64_t largeObject = 1024 * 1024;
        if (total >= largeObject && length < minimumProgress && end < total - 1)
            return { Reject::fragmentTooSmall };
    } else {
        total = advertisedLength;
    }
    if (total <= 0 || length <= 0 || offset >= total) return { Reject::missingTotal };
    return { Reject::none, total, length };
}
}
