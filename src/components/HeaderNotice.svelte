<script module lang="ts">
  export interface Notice {
    message: string;
    busy?: boolean;
    cancel?: () => void;
    dismiss?: () => void;
  }
</script>

<script lang="ts">
  let { notice }: { notice?: Notice } = $props();
</script>

{#if notice?.message}
  <div class="header-notice" role="status">
    <details>
      <summary aria-label="Show notification">
        {#if notice.busy}<span class="spinner" aria-hidden="true"></span>{:else}<span
            aria-hidden="true">ⓘ</span
          >{/if}
        <span class="notice-summary">{notice.message}</span>
      </summary>
    </details>
    <div class="toast notice-popover">
      <span>{notice.message}</span>
      {#if notice.cancel}<button class="tiny" onclick={notice.cancel}>Cancel</button>{/if}
      {#if notice.dismiss && !notice.busy}<button
          class="tiny"
          aria-label="Dismiss message"
          onclick={notice.dismiss}>×</button
        >{/if}
    </div>
  </div>
{/if}
