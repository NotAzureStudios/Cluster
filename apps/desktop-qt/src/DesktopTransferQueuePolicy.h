#pragma once

// Qt-independent queue retention contract. No incomplete transfer may be
// evicted simply because progress updates or another request grew the log.
// The actual on-disk writer may preserve MORE than this admission limit when
// importing an older queue; it must never truncate live entries on save.
#include <cstddef>
#include <string_view>

namespace cluster::desktop::transfer {
constexpr std::size_t admissionLimit = 200;

inline bool historyEvictable(std::string_view state) noexcept
{
    return state == "complete" || state == "cancelled";
}

inline bool mayAdmit(std::size_t existing) noexcept
{
    return existing < admissionLimit;
}
}
