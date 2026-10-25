#include "VariantListModel.h"

#include <QDateTime>
#include <QStringList>

#include <algorithm>

VariantListModel::VariantListModel(QObject *parent)
    : QAbstractListModel(parent)
{
}

int VariantListModel::rowCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : m_visible.size();
}

QVariant VariantListModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() < 0 || index.row() >= m_visible.size())
        return {};

    const QVariantMap item = m_visible.at(index.row()).toMap();
    switch (role) {
    case EntryRole: return item;
    case IdRole: return item.value(QStringLiteral("id"));
    case TitleRole: return displayValue(item, {QStringLiteral("title"), QStringLiteral("name"), QStringLiteral("displayName"), QStringLiteral("username")});
    case SubtitleRole: return displayValue(item, {QStringLiteral("subtitle"), QStringLiteral("description"), QStringLiteral("projectName"), QStringLiteral("department"), QStringLiteral("type")});
    case StatusRole: return item.value(QStringLiteral("status"));
    case PriorityRole: return item.value(QStringLiteral("priority"));
    case TimestampRole: return displayValue(item, {QStringLiteral("timestamp"), QStringLiteral("updatedAt"), QStringLiteral("createdAt"), QStringLiteral("startsAt"), QStringLiteral("dueDate")});
    case KindRole: return displayValue(item, {QStringLiteral("kind"), QStringLiteral("type"), QStringLiteral("category")});
    default: return {};
    }
}

QHash<int, QByteArray> VariantListModel::roleNames() const
{
    return {
        {EntryRole, QByteArrayLiteral("entry")},
        {IdRole, QByteArrayLiteral("entityId")},
        {TitleRole, QByteArrayLiteral("title")},
        {SubtitleRole, QByteArrayLiteral("subtitle")},
        {StatusRole, QByteArrayLiteral("status")},
        {PriorityRole, QByteArrayLiteral("priority")},
        {TimestampRole, QByteArrayLiteral("timestamp")},
        {KindRole, QByteArrayLiteral("kind")},
    };
}

int VariantListModel::count() const
{
    return m_visible.size();
}

QString VariantListModel::filterText() const
{
    return m_filterText;
}

void VariantListModel::setFilterText(const QString &value)
{
    const QString normalized = value.trimmed();
    if (m_filterText == normalized)
        return;
    m_filterText = normalized;
    emit filterTextChanged();
    rebuild();
}

QString VariantListModel::sortKey() const
{
    return m_sortKey;
}

void VariantListModel::setSortKey(const QString &value)
{
    const QString normalized = value.trimmed();
    if (m_sortKey == normalized)
        return;
    m_sortKey = normalized;
    emit sortKeyChanged();
    rebuild();
}

bool VariantListModel::sortDescending() const
{
    return m_sortDescending;
}

void VariantListModel::setSortDescending(bool value)
{
    if (m_sortDescending == value)
        return;
    m_sortDescending = value;
    emit sortDescendingChanged();
    rebuild();
}

void VariantListModel::replace(const QVariantList &items)
{
    if (m_source == items)
        return;
    m_source = items;
    emit sourceChanged();
    rebuild();
}

void VariantListModel::clear()
{
    replace({});
}

QVariantList VariantListModel::items() const
{
    return m_visible;
}

QVariantList VariantListModel::sourceItems() const
{
    return m_source;
}

QVariantMap VariantListModel::get(int index) const
{
    if (index < 0 || index >= m_visible.size())
        return {};
    return m_visible.at(index).toMap();
}

int VariantListModel::indexOfId(const QString &id) const
{
    for (int index = 0; index < m_visible.size(); ++index) {
        if (m_visible.at(index).toMap().value(QStringLiteral("id")).toString() == id)
            return index;
    }
    return -1;
}

void VariantListModel::rebuild()
{
    QVariantList next;
    next.reserve(m_source.size());
    const QString needle = m_filterText.toCaseFolded();
    for (const QVariant &value : std::as_const(m_source)) {
        const QVariantMap item = value.toMap();
        if (needle.isEmpty() || containsNeedle(item, needle))
            next.append(item);
    }

    if (!m_sortKey.isEmpty()) {
        const QString key = m_sortKey;
        const bool descending = m_sortDescending;
        std::stable_sort(next.begin(), next.end(), [key, descending](const QVariant &left, const QVariant &right) {
            const QVariant leftValue = left.toMap().value(key);
            const QVariant rightValue = right.toMap().value(key);
            const QDateTime leftDate = QDateTime::fromString(leftValue.toString(), Qt::ISODate);
            const QDateTime rightDate = QDateTime::fromString(rightValue.toString(), Qt::ISODate);
            int comparison = 0;
            if (leftDate.isValid() && rightDate.isValid()) {
                comparison = leftDate < rightDate ? -1 : leftDate > rightDate ? 1 : 0;
            } else {
                bool leftIsNumber = false;
                bool rightIsNumber = false;
                const double leftNumber = leftValue.toDouble(&leftIsNumber);
                const double rightNumber = rightValue.toDouble(&rightIsNumber);
                if (leftIsNumber && rightIsNumber)
                    comparison = leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
                else
                    comparison = QString::localeAwareCompare(leftValue.toString(), rightValue.toString());
            }
            return descending ? comparison > 0 : comparison < 0;
        });
    }

    const int previousCount = m_visible.size();
    beginResetModel();
    m_visible = next;
    endResetModel();
    if (previousCount != m_visible.size())
        emit countChanged();
}

QString VariantListModel::displayValue(const QVariantMap &item, const QStringList &keys)
{
    for (const QString &key : keys) {
        const QString value = item.value(key).toString().trimmed();
        if (!value.isEmpty())
            return value;
    }
    return {};
}

bool VariantListModel::containsNeedle(const QVariantMap &item, const QString &needle)
{
    static const QStringList searchableKeys {
        QStringLiteral("title"), QStringLiteral("name"), QStringLiteral("displayName"),
        QStringLiteral("preferredName"), QStringLiteral("username"), QStringLiteral("description"),
        QStringLiteral("projectName"), QStringLiteral("boardName"), QStringLiteral("department"),
        QStringLiteral("status"), QStringLiteral("priority"), QStringLiteral("type"),
        QStringLiteral("category"), QStringLiteral("message"), QStringLiteral("originalName"),
    };
    for (const QString &key : searchableKeys) {
        if (item.value(key).toString().toCaseFolded().contains(needle))
            return true;
    }
    const QVariantList tags = item.value(QStringLiteral("tags")).toList();
    for (const QVariant &tag : tags) {
        if (tag.toString().toCaseFolded().contains(needle))
            return true;
    }
    return false;
}
