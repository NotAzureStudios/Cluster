#include "PersistentCookieJar.h"

#include <QBuffer>
#include <QCryptographicHash>
#include <QDataStream>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QNetworkCookie>
#include <QSaveFile>
#include <QSettings>

#ifdef Q_OS_WIN
#include <windows.h>
#include <wincrypt.h>
#elif defined(Q_OS_MACOS)
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#elif defined(CLUSTER_HAS_LIBSECRET)
#include <libsecret/secret.h>
#endif

namespace {
constexpr auto CookieGroup = "sessions";
constexpr auto KeychainService = "studio.cluster.desktop.native-session";

QString originKey(const QString &origin)
{
    return QString::fromLatin1(QCryptographicHash::hash(origin.toUtf8(), QCryptographicHash::Sha256).toHex());
}

#ifdef Q_OS_MACOS
CFStringRef makeCfString(const QString &value)
{
    const QByteArray bytes = value.toUtf8();
    return CFStringCreateWithBytes(kCFAllocatorDefault,
                                   reinterpret_cast<const UInt8 *>(bytes.constData()),
                                   CFIndex(bytes.size()), kCFStringEncodingUTF8, false);
}

QByteArray keychainRead(const QString &profileId, const QString &origin)
{
    CFStringRef service = makeCfString(QString::fromLatin1(KeychainService));
    CFStringRef account = makeCfString(profileId + QLatin1Char('|') + originKey(origin));
    CFMutableDictionaryRef query = CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(query, kSecAttrService, service);
    CFDictionarySetValue(query, kSecAttrAccount, account);
    CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
    CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
    CFTypeRef result = nullptr;
    const OSStatus status = SecItemCopyMatching(query, &result);
    QByteArray output;
    if (status == errSecSuccess && result && CFGetTypeID(result) == CFDataGetTypeID()) {
        const auto data = static_cast<CFDataRef>(result);
        output = QByteArray(reinterpret_cast<const char *>(CFDataGetBytePtr(data)), CFDataGetLength(data));
    }
    if (result) CFRelease(result);
    CFRelease(query); CFRelease(account); CFRelease(service);
    return output;
}

bool keychainWrite(const QString &profileId, const QString &origin, const QByteArray &plain)
{
    CFStringRef service = makeCfString(QString::fromLatin1(KeychainService));
    CFStringRef account = makeCfString(profileId + QLatin1Char('|') + originKey(origin));
    CFDataRef data = CFDataCreate(kCFAllocatorDefault,
        reinterpret_cast<const UInt8 *>(plain.constData()), CFIndex(plain.size()));
    CFMutableDictionaryRef query = CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(query, kSecAttrService, service);
    CFDictionarySetValue(query, kSecAttrAccount, account);
    CFMutableDictionaryRef update = CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(update, kSecValueData, data);
    OSStatus status = SecItemUpdate(query, update);
    if (status == errSecItemNotFound) {
        CFDictionarySetValue(query, kSecValueData, data);
        status = SecItemAdd(query, nullptr);
    }
    CFRelease(update); CFRelease(query); CFRelease(data); CFRelease(account); CFRelease(service);
    return status == errSecSuccess;
}

void keychainDelete(const QString &profileId, const QString &origin)
{
    CFStringRef service = makeCfString(QString::fromLatin1(KeychainService));
    CFStringRef account = makeCfString(profileId + QLatin1Char('|') + originKey(origin));
    CFMutableDictionaryRef query = CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(query, kSecAttrService, service);
    CFDictionarySetValue(query, kSecAttrAccount, account);
    SecItemDelete(query);
    CFRelease(query); CFRelease(account); CFRelease(service);
}
#endif

#ifdef CLUSTER_HAS_LIBSECRET
const SecretSchema ClusterSessionSchema = {
    "studio.cluster.desktop.native-session", SECRET_SCHEMA_NONE,
    {
        {"profile", SECRET_SCHEMA_ATTRIBUTE_STRING},
        {"origin", SECRET_SCHEMA_ATTRIBUTE_STRING},
        {nullptr, SecretSchemaAttributeType(0)}
    }
};

QByteArray secretServiceRead(const QString &profileId, const QString &origin)
{
    GError *error = nullptr;
    const QByteArray profile = profileId.toUtf8();
    const QByteArray originHash = originKey(origin).toUtf8();
    gchar *password = secret_password_lookup_sync(&ClusterSessionSchema, nullptr, &error,
        "profile", profile.constData(), "origin", originHash.constData(), nullptr);
    QByteArray output;
    if (password) {
        output = QByteArray::fromBase64(QByteArray(password));
        secret_password_free(password);
    }
    if (error) g_error_free(error);
    return output;
}

bool secretServiceWrite(const QString &profileId, const QString &origin, const QByteArray &plain)
{
    GError *error = nullptr;
    const QByteArray profile = profileId.toUtf8();
    const QByteArray originHash = originKey(origin).toUtf8();
    const QByteArray encoded = plain.toBase64();
    const gboolean ok = secret_password_store_sync(&ClusterSessionSchema, SECRET_COLLECTION_DEFAULT,
        "Cluster Desktop native session", encoded.constData(), nullptr, &error,
        "profile", profile.constData(), "origin", originHash.constData(), nullptr);
    if (error) g_error_free(error);
    return ok;
}

void secretServiceDelete(const QString &profileId, const QString &origin)
{
    GError *error = nullptr;
    const QByteArray profile = profileId.toUtf8();
    const QByteArray originHash = originKey(origin).toUtf8();
    secret_password_clear_sync(&ClusterSessionSchema, nullptr, &error,
        "profile", profile.constData(), "origin", originHash.constData(), nullptr);
    if (error) g_error_free(error);
}
#endif
}

PersistentCookieJar::PersistentCookieJar(QObject *parent)
    : QNetworkCookieJar(parent)
{
}

void PersistentCookieJar::setProfileContext(const QString &profileId, const QString &origin, const QString &profileDataPath)
{
    const QString normalizedProfileId = profileId.trimmed();
    const QString normalizedOrigin = origin.trimmed();
    const QString trimmedPath = profileDataPath.trimmed();
    const QString normalizedPath = trimmedPath.isEmpty() ? QString() : QDir::cleanPath(trimmedPath);
    if (m_profileId == normalizedProfileId && m_origin == normalizedOrigin && m_profileDataPath == normalizedPath)
        return;
    m_profileId = normalizedProfileId;
    m_origin = normalizedOrigin;
    m_profileDataPath = normalizedPath;
    setAllCookies(QList<QNetworkCookie>{});
    load();
}

void PersistentCookieJar::clearForCurrentOrigin()
{
    setAllCookies(QList<QNetworkCookie>{});
#ifdef Q_OS_WIN
    const QString path = storagePath();
    if (!path.isEmpty() && QFileInfo::exists(path)) QFile::remove(path);
    if (!m_origin.isEmpty()) {
        QSettings settings;
        settings.beginGroup(QString::fromLatin1(CookieGroup));
        settings.remove(legacyStorageKey());
        settings.endGroup();
        settings.sync();
    }
#elif defined(Q_OS_MACOS)
    if (!m_profileId.isEmpty() && !m_origin.isEmpty()) keychainDelete(m_profileId, m_origin);
#elif defined(CLUSTER_HAS_LIBSECRET)
    if (!m_profileId.isEmpty() && !m_origin.isEmpty()) secretServiceDelete(m_profileId, m_origin);
#endif
}

bool PersistentCookieJar::persistenceAvailable() const
{
#ifdef Q_OS_WIN
    return true;
#elif defined(Q_OS_MACOS)
    return true;
#elif defined(CLUSTER_HAS_LIBSECRET)
    return true;
#else
    return false;
#endif
}

bool PersistentCookieJar::setCookiesFromUrl(const QList<QNetworkCookie> &cookieList, const QUrl &url)
{
    const bool changed = QNetworkCookieJar::setCookiesFromUrl(cookieList, url);
    if (changed) save();
    return changed;
}

bool PersistentCookieJar::deleteCookie(const QNetworkCookie &cookie)
{
    const bool changed = QNetworkCookieJar::deleteCookie(cookie);
    if (changed) save();
    return changed;
}

bool PersistentCookieJar::updateCookie(const QNetworkCookie &cookie)
{
    const bool changed = QNetworkCookieJar::updateCookie(cookie);
    if (changed) save();
    return changed;
}

bool PersistentCookieJar::insertCookie(const QNetworkCookie &cookie)
{
    const bool changed = QNetworkCookieJar::insertCookie(cookie);
    if (changed) save();
    return changed;
}

QString PersistentCookieJar::storagePath() const
{
    if (m_profileDataPath.isEmpty() || m_profileId.isEmpty()) return {};
    const QString sessionRoot = QDir::cleanPath(m_profileDataPath + QStringLiteral("/session"));
    QDir().mkpath(sessionRoot);
    return sessionRoot + QStringLiteral("/cookies.dpapi");
}

QString PersistentCookieJar::legacyStorageKey() const
{
    return QString::fromLatin1(QCryptographicHash::hash(m_origin.toUtf8(), QCryptographicHash::Sha256).toHex());
}

void PersistentCookieJar::load()
{
    if (!persistenceAvailable() || m_origin.isEmpty() || m_profileId.isEmpty()) return;

    QByteArray plain;
    bool migratedLegacy = false;
#ifdef Q_OS_WIN
    QByteArray cipher;
    const QString path = storagePath();
    if (!path.isEmpty()) {
        QFile file(path);
        if (file.open(QIODevice::ReadOnly)) cipher = file.readAll();
    }
    if (!cipher.isEmpty()) {
        plain = unprotect(cipher);
    } else {
        QSettings settings;
        settings.beginGroup(QString::fromLatin1(CookieGroup));
        const QByteArray legacyCipher = QByteArray::fromBase64(settings.value(legacyStorageKey()).toByteArray());
        settings.endGroup();
        if (!legacyCipher.isEmpty()) {
            plain = unprotectLegacy(legacyCipher);
            migratedLegacy = !plain.isEmpty();
        }
    }
#elif defined(Q_OS_MACOS)
    plain = keychainRead(m_profileId, m_origin);
#elif defined(CLUSTER_HAS_LIBSECRET)
    plain = secretServiceRead(m_profileId, m_origin);
#endif
    if (plain.isEmpty()) return;

    QList<QNetworkCookie> cookies;
    QBuffer buffer;
    buffer.setData(plain);
    if (!buffer.open(QIODevice::ReadOnly)) return;
    QDataStream stream(&buffer);
    stream.setVersion(QDataStream::Qt_6_5);
    quint32 count = 0;
    stream >> count;
    if (count > 128) return;
    for (quint32 index = 0; index < count && stream.status() == QDataStream::Ok; ++index) {
        QByteArray raw;
        stream >> raw;
        const auto parsed = QNetworkCookie::parseCookies(raw);
        if (!parsed.isEmpty()) cookies.append(parsed.first());
    }
    if (stream.status() != QDataStream::Ok) return;
    setAllCookies(cookies);

#ifdef Q_OS_WIN
    if (migratedLegacy) {
        save();
        QSettings settings;
        settings.beginGroup(QString::fromLatin1(CookieGroup));
        settings.remove(legacyStorageKey());
        settings.endGroup();
        settings.sync();
    }
#else
    Q_UNUSED(migratedLegacy)
#endif
}

void PersistentCookieJar::save() const
{
    if (!persistenceAvailable() || m_origin.isEmpty() || m_profileId.isEmpty()) return;

    const QList<QNetworkCookie> cookies = allCookies();
    QByteArray plain;
    QDataStream stream(&plain, QIODevice::WriteOnly);
    stream.setVersion(QDataStream::Qt_6_5);
    stream << quint32(cookies.size());
    for (const auto &cookie : cookies) stream << cookie.toRawForm(QNetworkCookie::Full);

#ifdef Q_OS_WIN
    const QByteArray cipher = protect(plain);
    const QString path = storagePath();
    if (cipher.isEmpty() || path.isEmpty()) return;
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly)) return;
    if (file.write(cipher) != cipher.size()) return;
    file.commit();
#elif defined(Q_OS_MACOS)
    keychainWrite(m_profileId, m_origin, plain);
#elif defined(CLUSTER_HAS_LIBSECRET)
    secretServiceWrite(m_profileId, m_origin, plain);
#endif
}

QByteArray PersistentCookieJar::protect(const QByteArray &plain) const
{
#ifdef Q_OS_WIN
    DATA_BLOB input{};
    input.pbData = reinterpret_cast<BYTE *>(const_cast<char *>(plain.constData()));
    input.cbData = static_cast<DWORD>(plain.size());
    DATA_BLOB output{};
    const QByteArray entropyValue = entropy();
    DATA_BLOB entropyBlob{};
    entropyBlob.pbData = reinterpret_cast<BYTE *>(const_cast<char *>(entropyValue.constData()));
    entropyBlob.cbData = static_cast<DWORD>(entropyValue.size());
    if (!CryptProtectData(&input, L"Cluster Desktop session", &entropyBlob, nullptr, nullptr,
                          CRYPTPROTECT_UI_FORBIDDEN, &output)) return {};
    const QByteArray result(reinterpret_cast<const char *>(output.pbData), static_cast<qsizetype>(output.cbData));
    LocalFree(output.pbData);
    return result;
#else
    Q_UNUSED(plain)
    return {};
#endif
}

QByteArray PersistentCookieJar::unprotect(const QByteArray &cipher) const
{
#ifdef Q_OS_WIN
    DATA_BLOB input{};
    input.pbData = reinterpret_cast<BYTE *>(const_cast<char *>(cipher.constData()));
    input.cbData = static_cast<DWORD>(cipher.size());
    DATA_BLOB output{};
    const QByteArray entropyValue = entropy();
    DATA_BLOB entropyBlob{};
    entropyBlob.pbData = reinterpret_cast<BYTE *>(const_cast<char *>(entropyValue.constData()));
    entropyBlob.cbData = static_cast<DWORD>(entropyValue.size());
    if (!CryptUnprotectData(&input, nullptr, &entropyBlob, nullptr, nullptr,
                            CRYPTPROTECT_UI_FORBIDDEN, &output)) return {};
    const QByteArray result(reinterpret_cast<const char *>(output.pbData), static_cast<qsizetype>(output.cbData));
    LocalFree(output.pbData);
    return result;
#else
    Q_UNUSED(cipher)
    return {};
#endif
}

QByteArray PersistentCookieJar::unprotectLegacy(const QByteArray &cipher) const
{
#ifdef Q_OS_WIN
    DATA_BLOB input{};
    input.pbData = reinterpret_cast<BYTE *>(const_cast<char *>(cipher.constData()));
    input.cbData = static_cast<DWORD>(cipher.size());
    DATA_BLOB output{};
    const QByteArray entropyValue = QByteArrayLiteral("ClusterDesktopSessionV1");
    DATA_BLOB entropyBlob{};
    entropyBlob.pbData = reinterpret_cast<BYTE *>(const_cast<char *>(entropyValue.constData()));
    entropyBlob.cbData = static_cast<DWORD>(entropyValue.size());
    if (!CryptUnprotectData(&input, nullptr, &entropyBlob, nullptr, nullptr,
                            CRYPTPROTECT_UI_FORBIDDEN, &output)) return {};
    const QByteArray result(reinterpret_cast<const char *>(output.pbData), static_cast<qsizetype>(output.cbData));
    LocalFree(output.pbData);
    return result;
#else
    Q_UNUSED(cipher)
    return {};
#endif
}

QByteArray PersistentCookieJar::entropy() const
{
    return QByteArrayLiteral("ClusterDesktopSessionV2|") + m_profileId.toUtf8();
}
