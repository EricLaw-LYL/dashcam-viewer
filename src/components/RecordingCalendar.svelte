<script lang="ts">
  import { DateTime } from 'luxon';
  let {
    dates,
    value,
    onchange,
    label = 'Recording calendar',
    placeholder = 'Select date',
    allowEmptyDays = false,
    min = '',
    max = '',
  }: {
    dates: string[];
    value: string;
    onchange: (day: string) => void;
    label?: string;
    placeholder?: string;
    allowEmptyDays?: boolean;
    min?: string;
    max?: string;
  } = $props();
  let open = $state(false),
    month = $state<DateTime>(DateTime.local().startOf('month'));
  const days = $derived(
    Array.from({ length: 42 }, (_, i) =>
      month.minus({ days: month.weekday % 7 }).plus({ days: i }),
    ),
  );
  function toggle() {
    if (!open) month = (value ? DateTime.fromISO(value) : DateTime.local()).startOf('month');
    open = !open;
  }
</script>

<div class="recording-calendar">
  <button class="date-select" aria-label={label} aria-expanded={open} onclick={toggle}
    >◷ {value ? DateTime.fromISO(value).toFormat('MMM d, yyyy') : placeholder}</button
  >
  {#if open}<div class="calendar-popover" role="dialog" aria-label="Choose recording day">
      <div class="calendar-heading">
        <button aria-label="Previous month" onclick={() => (month = month.minus({ months: 1 }))}
          >‹</button
        ><strong>{month.toFormat('MMMM yyyy')}</strong><button
          aria-label="Next month"
          onclick={() => (month = month.plus({ months: 1 }))}>›</button
        ><button aria-label="Close calendar" onclick={() => (open = false)}>×</button>
      </div>
      <div class="calendar-grid">
        {#each ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as day}<small>{day}</small>{/each}
        {#each days as day}{@const iso = day.toISODate()!}{@const available =
            dates.includes(iso)}<button
            class:other-month={day.month !== month.month}
            class:active={value === iso}
            class:has-footage={available}
            disabled={(!allowEmptyDays && !available) ||
              (!!min && iso < min) ||
              (!!max && iso > max)}
            aria-label={`${iso}${available ? ', footage available' : ', no footage'}`}
            onclick={() => {
              onchange(iso);
              open = false;
            }}>{day.day}</button
          >{/each}
      </div>
      <small>• Days with footage</small>
    </div>{/if}
</div>
