#pragma once

// Qt-free admission rules for persisted Desktop transfer metadata. Disk
// journals are recovery evidence, not executable instructions: a damaged
// entry must not select an arbitrary path for resuming or removing files.
#include <cstdint>
#include <string_view>

namespace cluster::desktop::journal {
constexpr std::int64_t maximumExactJsonInteger = (std::int64_t{1} << 53) - 1;
constexpr std::int64_t maximumJournalBytes = 16 * 1024 * 1024;

inline bool validState(std::string_view state) noexcept
{
    return state == "queued" || state == "running" || state == "paused"
        || state == "verifying" || state == "committing" || state == "failed"
        || state == "complete" || state == "cancelled";
}

inline bool validDirection(std::string_view direction) noexcept
{
    return direction == "upload" || direction == "download";
}

inline bool validProgress(std::int64_t total, std::int64_t transferred) noexcept
{
    return total >= 0 && total <= maximumExactJsonInteger
        && transferred >= 0 && transferred <= total;
}

// Millisecond UTC mtime is the durable source-generation receipt. This
// check only establishes range/integrity; Qt performs an actual file stat
// before each upload read and again before publishing verification.
inline bool validSourceModifiedAt(std::int64_t value) noexcept
{
    return value > 0 && value <= maximumExactJsonInteger;
}

inline bool validSha256(std::string_view sha, bool optional = true) noexcept
{
    if (sha.empty() && optional) return true;
    if (sha.size() != 64) return false;
    for (const auto value : sha) {
        if (!((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f')
            || (value >= 'A' && value <= 'F'))) return false;
    }
    return true;
}

// A server-completed upload can be safely finalized again after a lost reply
// only if the original, checksum-bound receipt was durably committed first.
inline bool validUploadCompletionReceipt(bool committed, std::string_view sessionId,
                                         std::int64_t total, std::int64_t transferred,
                                         std::string_view checksum) noexcept
{
    if (!committed) return true;
    // UUID syntax itself is validated by the native request policy.
    return !sessionId.empty() && validProgress(total, transferred)
        && transferred == total && validSha256(checksum, false);
}

inline bool pairedPartial(std::string_view finalPath, std::string_view partialPath) noexcept
{
    constexpr std::string_view suffix = ".cluster-part";
    if (finalPath.empty() || finalPath.size() > 4096
        || partialPath.size() != finalPath.size() + suffix.size()) return false;
    if (partialPath.substr(0, finalPath.size()) != finalPath
        || partialPath.substr(finalPath.size()) != suffix) return false;
    // Dot segments would let a journal direct filesystem actions outside the
    // literal parent folder. Qt also checks absolute path and expected root.
    if (finalPath.find("/../") != std::string_view::npos
        || finalPath.find("\\..\\") != std::string_view::npos
        || finalPath.find("/./") != std::string_view::npos
        || finalPath.find("\\.\\") != std::string_view::npos) return false;
    return true;
}

inline bool validCommitReceipt(std::string_view direction, bool committing,
                              std::int64_t total, std::int64_t transferred,
                              std::string_view sha) noexcept
{
    return !committing || (direction == "download" && total > 0
        && total == transferred && validSha256(sha, false));
}
}
