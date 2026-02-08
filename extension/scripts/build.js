import { build } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs-extra';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');

async function buildExtension() {
  console.log('🏗️  Building WebSense-AI Extension...\n');

  try {
    // Step 1: Build the popup with Vite
    console.log('📦 Building popup with Vite...');
    await build({
      configFile: resolve(rootDir, 'vite.config.js'),
      mode: 'production',
    });
    console.log('✅ Popup built successfully\n');

    // Step 2: Copy background script
    console.log('📋 Copying background script...');
    const backgroundSrc = resolve(rootDir, 'src/background/background.js');
    const backgroundDest = resolve(distDir, 'background.js');
    await fs.copy(backgroundSrc, backgroundDest);
    console.log('✅ Background script copied\n');

    // Step 3: Copy content script
    console.log('📋 Copying content script...');
    const contentSrc = resolve(rootDir, 'src/content/content.js');
    const contentDest = resolve(distDir, 'content.js');
    await fs.copy(contentSrc, contentDest);
    console.log('✅ Content script copied\n');

    // Step 4: Copy voiceControl script (injected by background.js)
    console.log('📋 Copying voiceControl script...');
    const voiceSrc = resolve(rootDir, 'src/features/voice/voiceControl.js');
    const voiceDest = resolve(distDir, 'voiceControl.js');
    await fs.copy(voiceSrc, voiceDest);
    console.log('✅ VoiceControl script copied\n');

    console.log('🎉 Build completed successfully!');
    console.log(`📁 Extension ready in: ${distDir}`);
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

buildExtension();
