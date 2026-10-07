<script lang="ts">
  import type { Snippet } from 'svelte';
  import HeaderNotice, { type Notice } from './HeaderNotice.svelte';
  let { title, notice, children }: { title: string; notice?: Notice; children?: Snippet } =
    $props();
</script>

<div class="page-heading">
  <h1 {title}>{title}<span>.</span></h1>
  <HeaderNotice {notice} />
  {#if children}<div class="page-heading-actions">{@render children()}</div>{/if}
</div>
