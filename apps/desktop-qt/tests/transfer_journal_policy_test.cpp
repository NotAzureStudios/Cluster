#include "../src/DesktopTransferJournalPolicy.h"
#include <cassert>
#include <iostream>
#include <string>
using namespace cluster::desktop::journal;
int main()
{
    int tests = 0;
    const auto check = [&tests](bool value) { assert(value); ++tests; };
    check(maximumJournalBytes == 16 * 1024 * 1024);
    check(maximumExactJsonInteger == 9007199254740991LL);
    for (const auto state : {"queued", "running", "paused", "verifying", "committing", "failed", "complete", "cancelled"})
        check(validState(state));
    check(!validState(""));
    check(!validState("installed"));
    check(!validState("COMPLETED"));
    check(validDirection("upload"));
    check(validDirection("download"));
    check(!validDirection("remove"));
    check(validProgress(0, 0));
    check(validSourceModifiedAt(1700000000000LL));
    check(validSourceModifiedAt(maximumExactJsonInteger));
    check(!validSourceModifiedAt(0));
    check(!validSourceModifiedAt(-1));
    check(!validSourceModifiedAt(maximumExactJsonInteger + 1));
    check(validProgress(1024, 0));
    check(validProgress(1024, 1024));
    check(!validProgress(1024, 1025));
    check(!validProgress(-1, 0));
    check(!validProgress(100, -1));
    check(!validProgress(maximumExactJsonInteger + 1, 1));
    const std::string hash(64, 'a');
    check(validSha256(hash));
    check(validSha256(std::string(64, 'F'), false));
    check(validSha256(""));
    check(!validSha256("", false));
    check(!validSha256(std::string(63, 'a')));
    check(!validSha256(std::string(64, 'z')));
    check(!validSha256(std::string(65, 'a')));
    check(pairedPartial("C:/Users/A/Downloads/scene.zip", "C:/Users/A/Downloads/scene.zip.cluster-part"));
    check(pairedPartial("/tmp/a", "/tmp/a.cluster-part"));
    check(!pairedPartial("/tmp/a", "/tmp/b.cluster-part"));
    check(!pairedPartial("/tmp/a", "/tmp/a.cluster-part/x"));
    check(!pairedPartial("/tmp/../secret", "/tmp/../secret.cluster-part"));
    check(!pairedPartial("/tmp/./secret", "/tmp/./secret.cluster-part"));
    check(!pairedPartial("C:\\tmp\\..\\secret", "C:\\tmp\\..\\secret.cluster-part"));
    check(!pairedPartial("", ".cluster-part"));
    check(!pairedPartial(std::string(4097, 'a'), std::string(4097, 'a') + ".cluster-part"));
    check(validUploadCompletionReceipt(false, "", 0, 0, ""));
    check(validUploadCompletionReceipt(true, "original-session", 42, 42, hash));
    check(validUploadCompletionReceipt(true, "original-session", 0, 0, hash));
    check(!validUploadCompletionReceipt(true, "", 42, 42, hash));
    check(!validUploadCompletionReceipt(true, "original-session", 42, 41, hash));
    check(!validUploadCompletionReceipt(true, "original-session", 42, 42, ""));
    check(!validUploadCompletionReceipt(true, "original-session", -1, 0, hash));
    check(validCommitReceipt("download", false, 0, 0, ""));
    check(validCommitReceipt("download", true, 1024, 1024, hash));
    check(!validCommitReceipt("upload", true, 1024, 1024, hash));
    check(!validCommitReceipt("download", true, 1024, 1023, hash));
    check(!validCommitReceipt("download", true, 0, 0, hash));
    check(!validCommitReceipt("download", true, 1024, 1024, ""));
    std::cout << "PASS " << tests << " journal recovery admission assertions\n";
}
