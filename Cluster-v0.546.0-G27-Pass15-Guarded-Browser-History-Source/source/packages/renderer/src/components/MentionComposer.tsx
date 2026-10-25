import { useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import "./mention-composer.css";
import { PresenceAvatar } from "./PresenceAvatar";
import { personStatusSummary } from "../features/people/person-summary";
import { ClusterTextArea } from "./ClusterTextArea";
import { ClusterButton } from "./ClusterButton";

export type MentionComposerUser = {
  id?: string;
  username?: string | null;
  displayName?: string | null;
  preferredName?: string | null;
  avatarUrl?: string | null;
  personalAccentColor?: string | null;
  status?: string | null;
  lastSeenAt?: string | null;
  archived?: boolean;
};

function normalized(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

export function mentionHandle(user: MentionComposerUser) {
  const username = String(user.username || "").trim();
  if (username) return username;
  return String(user.preferredName || user.displayName || "person")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "person";
}

export function mentionDisplayName(user: MentionComposerUser) {
  return String(user.preferredName || user.displayName || user.username || "Person").trim();
}

export function resolveMentionedUserIds(body: string, users: MentionComposerUser[]) {
  const tokens = new Set(Array.from(body.matchAll(/@([a-z0-9_.-]{2,64})/gi)).map((match) => normalized(match[1])));
  if (!tokens.size) return [];
  const ids: string[] = [];
  for (const user of users) {
    if (!user.id || user.archived) continue;
    const candidates = [mentionHandle(user), user.username, user.displayName, user.preferredName]
      .map(normalized)
      .filter(Boolean);
    if (candidates.some((candidate) => tokens.has(candidate))) ids.push(user.id);
  }
  return Array.from(new Set(ids));
}

function mentionAtCaret(value: string, caret: number) {
  const before = value.slice(0, Math.max(0, caret));
  const match = /(?:^|\s)@([a-z0-9_.-]{0,64})$/i.exec(before);
  if (!match) return null;
  const atOffset = match[0].lastIndexOf("@");
  return { query: normalized(match[1]), start: match.index + atOffset, end: caret };
}

export function MentionComposer({
  value,
  onChange,
  users,
  placeholder,
  rows = 3,
  disabled = false,
  onKeyDown,
  ariaLabel = "Comment",
}: {
  value: string;
  onChange: (value: string) => void;
  users: MentionComposerUser[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  ariaLabel?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionsId = useId();
  const [mention, setMention] = useState<{ query: string; start: number; end: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const query = mention.query;
    return users
      .filter((user) => !user.archived && Boolean(user.id))
      .filter((user) => {
        if (!query) return true;
        return [mentionHandle(user), user.username, user.displayName, user.preferredName]
          .some((candidate) => normalized(candidate).includes(query));
      })
      .sort((a, b) => {
        const aHandle = normalized(mentionHandle(a));
        const bHandle = normalized(mentionHandle(b));
        const aStarts = query && aHandle.startsWith(query) ? 0 : 1;
        const bStarts = query && bHandle.startsWith(query) ? 0 : 1;
        return aStarts - bStarts || mentionDisplayName(a).localeCompare(mentionDisplayName(b));
      })
      .slice(0, 7);
  }, [mention, users]);

  function refreshMention(nextValue: string, caret: number) {
    const nextMention = mentionAtCaret(nextValue, caret);
    setMention(nextMention);
    setActiveIndex(0);
  }

  function insertMention(user: MentionComposerUser) {
    if (!mention) return;
    const handle = mentionHandle(user);
    const next = `${value.slice(0, mention.start)}@${handle} ${value.slice(mention.end)}`;
    onChange(next);
    setMention(null);
    const caret = mention.start + handle.length + 2;
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (mention && suggestions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(suggestions[Math.min(activeIndex, suggestions.length - 1)]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    onKeyDown?.(event);
  }

  const mentionedIds = resolveMentionedUserIds(value, users);
  const mentioned = mentionedIds
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is MentionComposerUser => Boolean(user));

  return <div className="mention-composer-v493">
    <ClusterTextArea
      ref={textareaRef}
      aria-label={ariaLabel}
      aria-autocomplete="list"
      aria-controls={mention && suggestions.length ? suggestionsId : undefined}
      aria-expanded={Boolean(mention && suggestions.length)}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      rows={rows}
      onChange={(event) => {
        const next = event.target.value;
        onChange(next);
        refreshMention(next, event.target.selectionStart ?? next.length);
      }}
      onClick={(event) => {
        const next = event.currentTarget.value;
        refreshMention(next, event.currentTarget.selectionStart ?? next.length);
      }}
      onKeyUp={(event) => {
        if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
        const next = event.currentTarget.value;
        refreshMention(next, event.currentTarget.selectionStart ?? next.length);
      }}
      onKeyDown={handleKeyDown}
    />
    {mention && suggestions.length > 0 ? <div id={suggestionsId} className="mention-suggestions-v493" role="listbox" aria-label="Mention people">
      {suggestions.map((user, index) => <ClusterButton unstyled
        type="button"
        key={user.id}
        role="option"
        aria-selected={index === activeIndex}
        data-active={index === activeIndex || undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => insertMention(user)}
      >
        <PresenceAvatar userId={user.id || undefined} imageUrl={user.avatarUrl || undefined} accentColor={user.personalAccentColor || undefined} label={mentionDisplayName(user)} fallback={mentionDisplayName(user).slice(0, 1).toUpperCase()} state={personStatusSummary({ ...user, id: user.id || "mention", username: user.username || mentionHandle(user) }).presence} className="mention-avatar-v493" />
        <span><strong>{mentionDisplayName(user)}</strong><small>@{mentionHandle(user)} · {personStatusSummary({ ...user, id: user.id || "mention", username: user.username || mentionHandle(user) }).availabilityLabel}</small></span>
      </ClusterButton>)}
    </div> : null}
    {mentioned.length ? <div className="mention-selected-v493" aria-label="People mentioned in this comment">
      {mentioned.map((user) => <span key={user.id}>@{mentionHandle(user)}</span>)}
    </div> : null}
  </div>;
}
