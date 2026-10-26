import { ClusterButton } from "../../components/ClusterButton";
import { PersonSummary } from "../../components/PersonSummary";
import { ClusterEntityPicker } from "../../components/ClusterEntityPicker";
import { ClusterMultiSelect } from "../../components/ClusterMultiSelect";
import { ClusterIcon } from "../../components/ClusterIcon";
import type { ClusterPersonSummary } from "@cluster/shared";
import type { User, UserActivitySummary } from "../application/application-models";
import { displayUserName } from "./people-utils";
import { personMetaLabel } from "./person-summary";

type Person = User | UserActivitySummary | ClusterPersonSummary;

function personMeta(person: Person) {
  return personMetaLabel(person, { localTime: true });
}

export function PeoplePicker({
  value,
  onChange,
  people,
  label = "Person",
  emptyLabel = "Unassigned",
  ariaLabel = label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  people: Person[];
  label?: string;
  emptyLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const options = [
    { value: "", label: emptyLabel, meta: undefined },
    ...people.filter((person) => !person.archived).map((person) => ({
      value: person.id,
      label: displayUserName(person),
      meta: personMeta(person) || undefined,
    })),
  ];
  const selected = people.find((person) => person.id === value) || null;
  return (
    <div className="field people-picker">
      <label>{label}</label>
      <ClusterEntityPicker value={value} onChange={onChange} ariaLabel={ariaLabel} placeholder={emptyLabel} disabled={disabled} entities={options.map((option) => ({ id: option.value, label: option.label, meta: option.meta, kind: "person", icon: "user" }))} />
      {selected ? <PersonSummary person={selected} compact className="people-picker-summary-v493" /> : null}
    </div>
  );
}

export function PeopleMultiPicker({
  values,
  onChange,
  people,
  label = "People",
  emptyLabel = "Add person",
  disabled = false,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  people: Person[];
  label?: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const selected = values.map((id) => people.find((person) => person.id === id)).filter(Boolean) as Person[];
  const activePeople = people.filter((person) => !person.archived);
  return (
    <div className="field people-multi-picker">
      <label>{label}</label>
      <ClusterMultiSelect
        values={values}
        onChange={onChange}
        ariaLabel={label}
        placeholder={activePeople.length ? emptyLabel : "No people available"}
        disabled={disabled || activePeople.length === 0}
        options={activePeople.map((person) => ({ value: person.id, label: displayUserName(person), meta: personMeta(person) || undefined }))}
      />
      {selected.length > 0 ? (
        <div className="people-multi-picker-selection-v493" aria-label={`Selected ${label.toLowerCase()}`}>
          {selected.map((person) => (
            <div key={person.id} className="people-multi-picker-person-v493">
              <PersonSummary person={person} compact />
              <ClusterButton variant="quiet" size="compact" onClick={() => onChange(values.filter((id) => id !== person.id))} disabled={disabled} aria-label={`Remove ${displayUserName(person)}`}><ClusterIcon name="close" /></ClusterButton>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
