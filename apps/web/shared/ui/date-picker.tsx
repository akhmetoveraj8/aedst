"use client";

import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";
import type { Locale, Matcher } from "react-day-picker";

import { Button } from "@/shared/ui/button";
import { Calendar } from "@/shared/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

interface DatePickerProps {
  /** Controlled value; `null` is a controlled empty picker. */
  value?: Date | null;
  defaultValue?: Date;
  onValueChange?: (value: Date | undefined) => void;
  /** Trigger text while no date is selected (translated by the caller). */
  placeholder: string;
  /** Formats the selected date for the trigger (use `shared/date`). */
  formatDate: (date: Date) => string;
  /** react-day-picker locale: month and weekday names, week start. */
  locale?: Partial<Locale>;
  /** Dates that cannot be selected. */
  disabledDates?: Matcher | Matcher[];
  disabled?: boolean;
  id?: string;
  className?: string;
  /**
   * The trigger is named by its visible text (the date or the placeholder).
   * Describe the field with a visible caption and `aria-describedby`; an
   * `aria-label` would hide the visible text from the accessible name.
   */
  "aria-describedby"?: string;
}

/** shadcn/ui date picker: a `Calendar` (single mode) inside a `Popover`. */
function DatePicker({
  value,
  defaultValue,
  onValueChange,
  placeholder,
  formatDate,
  locale,
  disabledDates,
  disabled,
  className,
  ...triggerProps
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [internal, setInternal] = React.useState(defaultValue);
  const selected = value === undefined ? internal : (value ?? undefined);

  function handleSelect(next: Date | undefined) {
    if (value === undefined) {
      setInternal(next);
    }
    onValueChange?.(next);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            disabled={disabled}
            data-slot="date-picker"
            data-empty={selected === undefined}
            className={cn(
              "w-56 justify-start text-start font-normal data-[empty=true]:text-muted-foreground",
              className,
            )}
            {...triggerProps}
          />
        }
      >
        <HugeiconsIcon
          icon={Calendar03Icon}
          strokeWidth={2}
          data-icon="inline-start"
          aria-hidden="true"
        />
        {selected ? formatDate(selected) : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={handleSelect}
          locale={locale}
          disabled={disabledDates}
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker, type DatePickerProps };
