#pragma once

#include <QAbstractListModel>
#include <QByteArray>
#include <QString>
#include <QStringList>
#include <QVariantList>
#include <QVariantMap>

class VariantListModel final : public QAbstractListModel
{
    Q_OBJECT
    Q_PROPERTY(int count READ count NOTIFY countChanged)
    Q_PROPERTY(QString filterText READ filterText WRITE setFilterText NOTIFY filterTextChanged)
    Q_PROPERTY(QString sortKey READ sortKey WRITE setSortKey NOTIFY sortKeyChanged)
    Q_PROPERTY(bool sortDescending READ sortDescending WRITE setSortDescending NOTIFY sortDescendingChanged)
    Q_PROPERTY(QVariantList source READ sourceItems NOTIFY sourceChanged)

public:
    enum Role {
        EntryRole = Qt::UserRole + 1,
        IdRole,
        TitleRole,
        SubtitleRole,
        StatusRole,
        PriorityRole,
        TimestampRole,
        KindRole,
    };
    Q_ENUM(Role)

    explicit VariantListModel(QObject *parent = nullptr);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;
    QHash<int, QByteArray> roleNames() const override;

    int count() const;
    QString filterText() const;
    void setFilterText(const QString &value);
    QString sortKey() const;
    void setSortKey(const QString &value);
    bool sortDescending() const;
    void setSortDescending(bool value);

    void replace(const QVariantList &items);
    void clear();
    QVariantList items() const;
    QVariantList sourceItems() const;

    Q_INVOKABLE QVariantMap get(int index) const;
    Q_INVOKABLE int indexOfId(const QString &id) const;

signals:
    void countChanged();
    void filterTextChanged();
    void sortKeyChanged();
    void sortDescendingChanged();
    void sourceChanged();

private:
    void rebuild();
    static QString displayValue(const QVariantMap &item, const QStringList &keys);
    static bool containsNeedle(const QVariantMap &item, const QString &needle);

    QVariantList m_source;
    QVariantList m_visible;
    QString m_filterText;
    QString m_sortKey;
    bool m_sortDescending = false;
};
