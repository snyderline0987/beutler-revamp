#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

const KEY = process.env.KIE_API_KEY || 'PASTE_KEY_HERE';
const KIE = 'https://api.kie.ai';
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const OUT_DIR = path.join(__dirname, 'assets');

async function createTask(model, input) {
  console.log(`\n📤 Submitting ${model}...`);
  const res = await fetch(`${KIE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, ...input })
  });
  const json = await res.json();
  if (json.code !== 200 || !json.data?.taskId) throw new Error(JSON.stringify(json));
  return json.data.taskId;
}

async function pollTask(taskId, label) {
  let delay = 5000;
  const start = Date.now();
  console.log(`\n⏳ Polling ${label} (taskId: ${taskId})`);
  while (Date.now() - start < 600_000) {
    await new Promise(r => setTimeout(r, delay));
    const res = await fetch(`${KIE}/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      headers: { 'Authorization': `Bearer ${KEY}` }
    });
    const json = await res.json();
    const task = json.data || {};
    const status = task.status || task.taskStatus || '?';
    const state = task.data?.state || '';
    
    if (status === 'success' || status === 'SUCCEED') return task;
    if (['fail', 'error', 'FAIL'].includes(status)) throw new Error(`Failed: ${JSON.stringify(task)}`);
    
    console.log(`   [${Math.round((Date.now()-start)/1000)}s] Status: ${status} | State: ${state}`);
    delay = Math.min(delay * 1.5, 15000);
  }
  throw new Error('Timeout');
}

function extractUrl(task) {
  const c = [
    task.resultUrl, task.videoUrl, task.imageUrl, task.url,
    task.data?.resultJson?.url,
    Array.isArray(task.imageUrls) ? task.imageUrls[0] : null,
    Array.isArray(task.videoUrls) ? task.videoUrls[0] : null,
    Array.isArray(task.results) ? task.results[0]?.url : null
  ];
  return c.find(url => typeof url === 'string' && url.startsWith('http')) || null;
}

async function download(url, filename) {
  const outPath = path.join(OUT_DIR, filename);
  console.log(`\n💾 Downloading → ${filename}`);
  const res = await fetch(url);
  await pipeline(res.body, createWriteStream(outPath));
  console.log(`   ✅ Saved ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB`);
  return url;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Prompt for architecture photography studio - dark cinematic mood
  const prompt = "Cinematic ultra-wide establishing shot of a modern architectural photography studio interior. Dark moody atmosphere with dramatic side lighting through large floor-to-ceiling windows. Minimalist concrete walls, professional camera equipment silhouettes, geometric shadows. Premium luxury aesthetic, photorealistic, 8k resolution, architectural photography style, no text, warm amber accent lighting";
  
  // 1. Generate Base Image (Google Imagen4 Fast for quality)
  console.log("🎨 Generating hero image...");
  const imgTaskId = await createTask('google/imagen4-fast', {
    input: {
      prompt: prompt,
      aspectRatio: '16:9',
      outputFormat: 'jpeg'
    }
  });
  const imgResult = await pollTask(imgTaskId, 'Image Generation');
  const imgUrl = extractUrl(imgResult);
  if (!imgUrl) throw new Error('No image URL found');
  await download(imgUrl, 'hero_bg.jpg');

  // 2. Animate Image to Video (Kling 2.6 i2v)
  console.log("\n🎬 Generating hero video from image...");
  const vidTaskId = await createTask('kling/image-to-video', {
    input: {
      prompt: "Camera slowly pushes forward through the studio, subtle dust particles floating in light beams, smooth cinematic dolly movement, ambient light shifts gently",
      imageUrl: imgUrl,
      duration: 5,
      aspectRatio: "16:9",
      mode: "standard"
    }
  });
  const vidResult = await pollTask(vidTaskId, 'Video Generation');
  const vidUrl = extractUrl(vidResult);
  if (vidUrl) {
    await download(vidUrl, 'hero_bg.mp4');
  } else {
    console.warn("⚠️  Could not extract video URL, but image was saved.");
  }
  
  console.log('\n🎉 Assets complete!');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
