<script setup lang="ts">
const router = useRouter();

const form = reactive({
  id: "",
  name: "",
  summary: "",
  description: "",
  version: "0.1.0",
  releaseNotes: "Initial release",
  entryFile: "SKILL.md",
  readme: ""
});

const isPending = ref(false);
const errorMsg = ref("");
const artifactFile = ref<File | null>(null);

async function handlePublish() {
  errorMsg.value = "";
  isPending.value = true;

  try {
    const result = await $fetch<{ skill: { id: string } }>("/api/skills", {
      method: "POST",
      body: {
        id: form.id,
        name: form.name,
        summary: form.summary,
        description: form.description
      }
    });

    if (!artifactFile.value) {
      throw new Error("Please choose a zip package before publishing.");
    }

    const formData = new FormData();
    formData.append("version", form.version);
    formData.append("releaseNotes", form.releaseNotes);
    formData.append("entryFile", form.entryFile);
    formData.append("readme", form.readme || `# ${form.name}\n\n${form.description}`);
    formData.append("file", artifactFile.value);

    await $fetch(`/api/skills/${result.skill.id}/releases`, {
      method: "POST",
      body: formData
    });

    await router.push(`/skills/${result.skill.id}`);
  } catch (error: any) {
    errorMsg.value = error?.data?.statusMessage || error?.statusMessage || error?.message || "Create skill failed.";
  } finally {
    isPending.value = false;
  }
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  artifactFile.value = input.files?.[0] ?? null;
}

useHead({
  title: "Create Skill | MyClaw Cloud"
});
</script>

<template>
  <main class="nuxt-publish-web-page">
    <div class="publish-container-nx">
      <div class="publish-header-nx">
        <NuxtLink class="back-link-nx" to="/skills">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back to Registry
        </NuxtLink>
        <div class="title-area">
          <h2>Publish <span class="dim">Skill</span></h2>
          <p class="subtitle">Deploy your cloud skill to the platform registry.</p>
        </div>
      </div>

      <form class="desktop-form-layout" @submit.prevent="handlePublish">
        <div class="layout-main">
          <section class="form-card-nx glass-card-nx">
            <header class="section-head">
              <h3>Basic Information</h3>
              <p>Essential details for the marketplace catalog.</p>
            </header>
            
            <div class="form-group mb-xl">
              <label>Skill Name</label>
              <input v-model="form.name" type="text" placeholder="e.g. Data Analyzer" required />
            </div>

            <div class="form-group mb-xl">
              <label>Short Summary</label>
              <input v-model="form.summary" type="text" placeholder="One-line summary for the skills list" required />
            </div>

            <div class="form-group">
              <label>Detailed Description</label>
              <textarea v-model="form.description" rows="4" placeholder="What does this skill do? Features, use-cases..." required></textarea>
            </div>
          </section>

          <section class="form-card-nx glass-card-nx">
            <header class="section-head">
              <h3>Documentation & Notes</h3>
              <p>Provide a comprehensive guide and changelog.</p>
            </header>

            <div class="form-group mb-xl">
              <label>Release Notes</label>
              <textarea v-model="form.releaseNotes" rows="3" placeholder="What changed in this release?" required></textarea>
            </div>

            <div class="form-group">
              <label>README (Markdown)</label>
              <textarea v-model="form.readme" rows="12" class="mono-font" placeholder="# Skill Name&#10;&#10;Usage notes..."></textarea>
            </div>
          </section>
        </div>

        <aside class="layout-sidebar">
          <section class="form-card-nx glass-card-nx config-panel">
            <header class="section-head">
              <h3>Configuration</h3>
            </header>

            <div class="form-group mb-lg">
              <label>Skill ID <span class="req">*</span></label>
              <div class="input-wrapper">
                <span class="prefix">@myclaw/</span>
                <input v-model="form.id" type="text" placeholder="example-skill" required />
              </div>
            </div>

            <div class="row-inputs mb-lg">
              <div class="form-group flex-1">
                <label>Version</label>
                <input v-model="form.version" type="text" placeholder="0.1.0" required />
              </div>
              <div class="form-group flex-1">
                <label>Entry File</label>
                <input v-model="form.entryFile" type="text" placeholder="SKILL.md" required />
              </div>
            </div>
          </section>

          <section class="form-card-nx glass-card-nx artifact-panel">
            <header class="section-head">
              <h3>Artifact</h3>
              <p>Upload the skill package.</p>
            </header>

            <div class="form-group">
              <div class="drop-zone-nx" :class="{ active: artifactFile }">
                <input type="file" accept=".zip" required @change="handleFileChange" />
                <div class="drop-content">
                  <svg v-if="!artifactFile" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="success-icon"><path d="M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3"/></svg>
                  <span>{{ artifactFile ? artifactFile.name : "Select ZIP file" }}</span>
                </div>
              </div>
            </div>
          </section>

          <div v-if="errorMsg" class="status-msg error">
            {{ errorMsg }}
          </div>

          <div class="publish-actions-nx glass-card-nx">
            <button type="submit" class="submit-btn-nx" :disabled="isPending || !artifactFile">
              <span v-if="isPending" class="spinner"></span>
              {{ isPending ? "Publishing..." : "Publish to Registry" }}
            </button>
          </div>
        </aside>
      </form>
    </div>
  </main>
</template>

<style scoped>
.nuxt-publish-web-page { position: relative; min-height: calc(100vh - 64px); background: var(--bg-main); width: 100%; padding-bottom: 80px; }
.publish-container-nx { max-width: 1440px; margin: 0 auto; padding: 40px; }

.publish-header-nx { margin-bottom: 40px; display: flex; flex-direction: column; gap: 16px; }
.back-link-nx { display: inline-flex; align-items: center; gap: 8px; color: var(--text-dim); text-decoration: none; font-weight: 800; font-size: 0.85rem; transition: 0.2s; align-self: flex-start; padding: 6px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; }
.back-link-nx:hover { color: var(--text-main); background: rgba(255,255,255,0.08); }
.back-link-nx svg { width: 16px; height: 16px; }
.title-area h2 { font-size: 2rem; font-weight: 900; color: var(--text-main); letter-spacing: -0.02em; margin: 0 0 4px; }
.title-area .dim { color: var(--text-dim); }
.subtitle { color: var(--text-muted); font-size: 1rem; margin: 0; }

.desktop-form-layout { display: grid; grid-template-columns: 1fr 400px; gap: 32px; align-items: start; }
@media (max-width: 1024px) { .desktop-form-layout { grid-template-columns: 1fr; } }

.layout-main { display: flex; flex-direction: column; gap: 32px; }
.layout-sidebar { display: flex; flex-direction: column; gap: 32px; position: sticky; top: 40px; }

.form-card-nx { padding: 32px; border-radius: 20px; background: var(--bg-main); border: 1px solid var(--border-muted); box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
.section-head { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); }
.section-head h3 { margin: 0 0 6px; font-size: 1.25rem; font-weight: 900; color: var(--text-main); }
.section-head p { margin: 0; font-size: 0.9rem; color: var(--text-muted); }

.form-group { display: flex; flex-direction: column; gap: 10px; }
.mb-lg { margin-bottom: 20px; }
.mb-xl { margin-bottom: 28px; }
.row-inputs { display: flex; gap: 16px; }
.flex-1 { flex: 1; }

.form-group label { font-size: 0.8rem; font-weight: 900; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between; }
.req { color: #ef4444; }

.form-group input, .form-group textarea { width: 100%; padding: 14px 18px; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 12px; color: var(--text-main); font-family: inherit; font-size: 0.95rem; transition: 0.2s; box-sizing: border-box; }
.form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--nuxt-green); box-shadow: 0 0 0 3px rgba(var(--nuxt-green-rgb), 0.1); background: rgba(var(--nuxt-green-rgb), 0.02); }
.mono-font { font-family: 'Fira Code', monospace !important; font-size: 0.85rem !important; line-height: 1.6; }

.input-wrapper { display: flex; align-items: center; background: var(--bg-input); border: 1px solid var(--border-main); border-radius: 12px; overflow: hidden; transition: 0.2s; }
.input-wrapper:focus-within { border-color: var(--nuxt-green); box-shadow: 0 0 0 3px rgba(var(--nuxt-green-rgb), 0.1); background: rgba(var(--nuxt-green-rgb), 0.02); }
.input-wrapper .prefix { padding-left: 16px; color: var(--text-dim); font-family: 'Fira Code', monospace; font-size: 0.9rem; user-select: none; }
.input-wrapper input { border: none !important; background: transparent !important; box-shadow: none !important; padding-left: 8px; }

.config-panel { padding: 24px; }
.artifact-panel { padding: 24px; }

.drop-zone-nx { height: 140px; border: 2px dashed var(--border-muted); border-radius: 16px; position: relative; transition: 0.2s; background: rgba(255,255,255,0.02); cursor: pointer; overflow: hidden; }
.drop-zone-nx:hover { border-color: var(--text-dim); background: rgba(255,255,255,0.04); }
.drop-zone-nx.active { border-color: var(--nuxt-green); background: rgba(var(--nuxt-green-rgb), 0.05); }
.drop-zone-nx input { position: absolute; inset: 0; opacity: 0; cursor: pointer; z-index: 10; width: 100%; height: 100%; }
.drop-content { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-dim); z-index: 5; pointer-events: none; }
.drop-content svg { width: 36px; height: 36px; opacity: 0.6; }
.success-icon { color: var(--nuxt-green); opacity: 1 !important; }
.drop-content span { font-size: 0.9rem; font-weight: 800; color: var(--text-muted); text-align: center; padding: 0 16px; }
.drop-zone-nx.active .drop-content span { color: var(--nuxt-green); }

.status-msg { padding: 16px; border-radius: 12px; font-size: 0.875rem; font-weight: 700; display: flex; align-items: center; gap: 8px; margin-top: -16px; }
.status-msg.error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; }

.publish-actions-nx { padding: 24px; border-radius: 20px; background: var(--bg-main); border: 1px solid var(--border-muted); }
.submit-btn-nx { width: 100%; height: 52px; background: var(--nuxt-green); color: var(--btn-text); border: none; border-radius: 12px; font-weight: 900; font-size: 1.05rem; cursor: pointer; transition: 0.3s; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 4px 15px rgba(var(--nuxt-green-rgb), 0.2); letter-spacing: 0.02em; }
.submit-btn-nx:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(var(--nuxt-green-rgb), 0.4); }
.submit-btn-nx:disabled { opacity: 0.5; filter: grayscale(1); cursor: not-allowed; box-shadow: none; transform: none; }
.spinner { width: 18px; height: 18px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
