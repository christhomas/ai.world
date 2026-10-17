package world.ai.ai_world_flutter

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

/**
 * The game's sounds (#578). Dart makes each one, as 16-bit mono samples, from what the game says it is
 * made of; this plays it on its own static AudioTrack, marked as a game's sound so it follows the
 * media volume, and lets the track go once it has played. A sound that cannot be played is dropped.
 */
internal class SoundBridge(messenger: BinaryMessenger) {
    private val channel = MethodChannel(messenger, "world.ai/sound")
    private val main = Handler(Looper.getMainLooper())
    private val playing = mutableSetOf<AudioTrack>()

    init {
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "play" -> {
                    val pcm = call.argument<ByteArray>("pcm")
                    val rate = call.argument<Int>("rate") ?: 44100
                    if (pcm == null || pcm.size < 2 || rate !in 8000..96000) {
                        result.error("bad-sound", "A sound needs 16-bit samples and a rate", null)
                    } else {
                        try {
                            play(pcm, rate)
                            result.success(null)
                        } catch (error: Exception) {
                            result.error("sound-failed", error.message, null)
                        }
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun play(pcm: ByteArray, rate: Int) {
        val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build())
            .setAudioFormat(AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(rate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(pcm.size)
            .build()
        track.write(pcm, 0, pcm.size)
        track.play()
        playing.add(track)
        // let the track go once it has played out, with a moment to spare
        val millis = pcm.size / 2 * 1000L / rate + 200
        main.postDelayed({
            if (playing.remove(track)) {
                track.stop()
                track.release()
            }
        }, millis)
    }

    fun dispose() {
        channel.setMethodCallHandler(null)
        main.removeCallbacksAndMessages(null)
        for (track in playing) {
            track.stop()
            track.release()
        }
        playing.clear()
    }
}
