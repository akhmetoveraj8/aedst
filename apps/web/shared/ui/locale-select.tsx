"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

type LocaleOption = { value: string; label: string };

type LocaleSelectProps = {
  value: string;
  options: readonly LocaleOption[];
  /** Accessible name of the control (there is no visible label). */
  label: string;
  onValueChange: (value: string) => void;
  className?: string;
};

/**
 * Presentational language picker: a `Select` whose options are the languages'
 * own names. It knows nothing about routing; `app/shell/LocaleSwitcher` wires
 * it to next-intl.
 */
export function LocaleSelect({
  value,
  options,
  label,
  onValueChange,
  className,
}: LocaleSelectProps) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") {
          onValueChange(next);
        }
      }}
    >
      <SelectTrigger size="sm" className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
