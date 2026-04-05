import ffmpeg from 'fluent-ffmpeg';

function resolveFfprobe(options = {}) {
  return options.ffprobe || ffmpeg.ffprobe.bind(ffmpeg);
}

export async function probeVideoDurationSec(videoPath, options = {}) {
  const ffprobe = resolveFfprobe(options);

  const metadata = await new Promise((resolve, reject) => {
    ffprobe(videoPath, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data || {});
    });
  });

  const durationSec = Number.parseFloat(String(metadata?.format?.duration ?? '').trim());
  return Number.isFinite(durationSec) ? durationSec : null;
}

export async function probeVideoMetadata(videoPath, options = {}) {
  const durationSec = await probeVideoDurationSec(videoPath, options);
  return {
    durationSec,
  };
}

export default {
  probeVideoDurationSec,
  probeVideoMetadata,
};
