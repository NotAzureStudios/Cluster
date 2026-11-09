#pragma once

// Qt-free final admission contract for the legacy direct-download API.
// The resumable TransferManager has a separate range policy: these simpler
// fresh downloads must never publish a 206 fragment as a complete file.
#include <cstdint>

namespace cluster::desktop::directdownload {
enum class Decision { accept, rejectedStatus, interrupted, writeError, invalidLength };

inline Decision admit(int httpStatus, bool transportFailure, bool writeFailure,
                      std::int64_t receivedBytes, std::int64_t declaredBytes = -1) noexcept
{
    if (writeFailure) return Decision::writeError;
    if (httpStatus != 200) return Decision::rejectedStatus;
    if (transportFailure) return Decision::interrupted;
    // -1 means no Content-Length (e.g. chunked HTTP response).
    if (receivedBytes < 0 || declaredBytes < -1
        || (declaredBytes >= 0 && receivedBytes != declaredBytes))
        return Decision::invalidLength;
    return Decision::accept;
}
}
