import { useEffect, useState } from "react";
import { api } from "../../../core/api";
import { ClusterNativeSelect } from "../../../components/ClusterNativeControls";
import type { Board, Card } from "../application-models";
import { allBoardCards } from "./application-foundation";

export function CardSelect({ boardId, value, onChange }: { boardId: string; value: string; onChange: (value: string) => void }) {
  const [cards, setCards] = useState<Card[]>([]);
  useEffect(() => {
    if (!boardId) {
      setCards([]);
      onChange("");
      return;
    }
    api<Board>(`/api/boards/${boardId}`)
      .then((board) => setCards(allBoardCards(board)))
      .catch(() => setCards([]));
  }, [boardId]);
  return (
    <ClusterNativeSelect aria-label="Linked card" value={value} onChange={(event) => onChange(event.target.value)} disabled={!boardId}>
      <option value="">No linked card</option>
      {cards.map((card) => (
        <option key={card.id} value={card.id}>
          {card.title}
        </option>
      ))}
    </ClusterNativeSelect>
  );
}

