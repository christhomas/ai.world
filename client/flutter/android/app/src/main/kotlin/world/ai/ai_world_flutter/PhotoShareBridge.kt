package world.ai.ai_world_flutter

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.io.File

class PhotoFileProvider : FileProvider()

/** A PNG from Dart, handed to the sharesheet with access to that cache file alone (#578). */
internal class PhotoShareBridge(private val activity: Activity, messenger: BinaryMessenger) {
    private val channel = MethodChannel(messenger, "world.ai/photo")
    private var pending: MethodChannel.Result? = null

    init {
        channel.setMethodCallHandler { call, result ->
            if (call.method != "share") {
                result.notImplemented()
            } else if (pending != null) {
                result.error("share-busy", "A photo is already being shared", null)
            } else {
                val png = call.argument<ByteArray>("png")
                if (png == null || !png.take(8).toByteArray().contentEquals(PNG_SIGNATURE)) {
                    result.error("bad-photo", "A photo needs PNG bytes", null)
                } else {
                    share(png, result)
                }
            }
        }
    }

    private fun share(png: ByteArray, result: MethodChannel.Result) {
        var file: File? = null
        try {
            check(!activity.isFinishing && !activity.isDestroyed) { "The game is no longer on screen" }
            val directory = File(activity.cacheDir, "shared-photos")
            check(directory.isDirectory || directory.mkdirs()) { "The photo cache is unavailable" }
            // A receiver may read after the chooser has gone away. Keep its file until tomorrow,
            // rather than deleting it as soon as Android returns to the game.
            val yesterday = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
            directory.listFiles()?.filter { it.lastModified() < yesterday }?.forEach { it.delete() }
            val photo = File.createTempFile("ai-world-", ".png", directory)
            file = photo
            photo.writeBytes(png)
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.photos", photo)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newUri(activity.contentResolver, "AI World photo", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, "Share photo").apply {
                clipData = send.clipData
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            pending = result
            activity.startActivityForResult(chooser, REQUEST_SHARE)
        } catch (error: Exception) {
            pending = null
            runCatching { file?.delete() }
            result.error("share-failed", error.message, null)
        }
    }

    fun onActivityResult(requestCode: Int): Boolean {
        if (requestCode != REQUEST_SHARE) return false
        // ACTION_SEND does not promise whether the receiving app sent or saved anything. Even a
        // RESULT_CANCELED can follow a chosen app, so the only honest acknowledgement is "closed".
        val result = pending
        pending = null
        result?.success("closed")
        return true
    }

    fun dispose() {
        channel.setMethodCallHandler(null)
        val result = pending
        pending = null
        result?.success("cancelled")
    }

    companion object {
        private const val REQUEST_SHARE = 578
        private val PNG_SIGNATURE = byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10)
    }
}
