#include "../src/DesktopTransferRequestPolicy.h"
#include <cassert>
#include <iostream>
#include <string>
using namespace cluster::desktop::request;
int main()
{
    int passed=0;
    const auto check=[&passed](bool ok) { assert(ok); ++passed; };
    check(sameServerApiPath("/api/review-assets/abc/download"));
    check(sameServerApiPath("/api/projects/x/files?format=zip"));
    check(sameServerApiPath("/api/files/a%20b"));
    check(!sameServerApiPath(""));
    check(!sameServerApiPath("/"));
    check(!sameServerApiPath("/health/ready"));
    check(!sameServerApiPath("http://example.com/api/x"));
    check(!sameServerApiPath("https://example.com/api/x"));
    check(!sameServerApiPath("//example.com/api/x"));
    check(!sameServerApiPath("/api//example.com/x"));
    check(!sameServerApiPath("/api/../admin"));
    check(!sameServerApiPath("/api/./admin"));
    check(!sameServerApiPath("/api/.."));
    check(!sameServerApiPath("/api/."));
    check(!sameServerApiPath("/api/%2f/secret"));
    check(!sameServerApiPath("/api/%2F/secret"));
    check(!sameServerApiPath("/api/%2e%2e/secret"));
    check(!sameServerApiPath("/api/%2E%2E/secret"));
    check(!sameServerApiPath("/api/%25%32%65"));
    check(!sameServerApiPath("/api/%5c/secret"));
    check(!sameServerApiPath("/api/a\\b"));
    check(!sameServerApiPath("/api/x#fragment"));
    check(!sameServerApiPath("/api/x\n"));
    check(!sameServerApiPath(std::string("/api/")+std::string(4096,'a')));
    check(validUploadId("84c5a1b7-2848-4ae6-83d3-abd07ae41aa4"));
    check(validUploadId("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"));
    check(!validUploadId(""));
    check(!validUploadId("other-session"));
    check(!validUploadId("84c5a1b7/2848-4ae6-83d3-abd07ae41aa4"));
    check(!validUploadId("84c5a1b7-2848-4ae6-83d3-abd07ae41aaZ"));
    check(projectFileFinalizationPath("/api/projects/abc_123/files"));
    check(projectFileFinalizationPath("/api/projects/0000-1111-2222/files"));
    check(!projectFileFinalizationPath("/api/projects/../files"));
    check(!projectFileFinalizationPath("/api/projects/abc/files/../../admin"));
    check(!projectFileFinalizationPath("/api/projects/abc/files?redirect=1"));
    check(!projectFileFinalizationPath("//evil.example/api/projects/abc/files"));
    check(!projectFileFinalizationPath("/api/projects//files"));
    check(!projectFileFinalizationPath("/api/projects/%2e%2e/files"));
    std::cout << "PASS " << passed << " origin-bound native transfer request assertions\n";
}
