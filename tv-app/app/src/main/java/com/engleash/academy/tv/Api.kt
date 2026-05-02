package com.engleash.academy.tv

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

sealed class LoginResult {
    data class Success(val response: LoginResponse) : LoginResult()
    data class AlreadyLoggedIn(val deviceName: String) : LoginResult()
}

object Api {
    private const val BASE = "https://api.engleashacademy.in"
    private const val PREFS = "engleash_tv"
    private const val KEY_TOKEN = "token"
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private const val JSON = "application/json; charset=utf-8"

    var token: String? = null
        private set

    @Volatile
    private var appContext: Context? = null

    fun init(context: Context) {
        appContext = context.applicationContext
        token = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TOKEN, null)
    }

    private fun saveToken(context: Context, t: String?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_TOKEN, t).apply()
        token = t
    }

    fun clearToken(context: Context) {
        saveToken(context, null)
    }

    private fun deviceName(): String = "Android TV (${Build.MODEL})"

    suspend fun login(email: String, password: String, context: Context): Result<LoginResult> = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("email", email)
            put("password", password)
            put("role", "Lab")
            put("client", "tv")
            put("deviceName", deviceName())
        }.toString()
        val req = Request.Builder()
            .url("$BASE/api/auth/login")
            .post(body.toRequestBody(JSON.toMediaType()))
            .addHeader("Content-Type", JSON)
            .build()
        runCatching {
            client.newCall(req).execute().use { r ->
                val str = r.body?.string() ?: ""
                if (!r.isSuccessful) {
                    val err = JSONObject(str).optString("error", "Login failed")
                    return@withContext Result.failure(Exception(err))
                }
                val json = JSONObject(str)
                if (json.optBoolean("alreadyLoggedIn", false)) {
                    return@withContext Result.success(LoginResult.AlreadyLoggedIn(json.optString("deviceName", "another device")))
                }
                val tok = json.getString("token")
                saveToken(context, tok)
                val user = json.getJSONObject("user")
                Result.success(
                    LoginResult.Success(
                        LoginResponse(
                            token = tok,
                            user = User(
                                id = user.getInt("id"),
                                email = user.getString("email"),
                                name = user.optString("name", ""),
                                role = user.getString("role")
                            )
                        )
                    )
                )
            }
        }.getOrElse { Result.failure(it) }
    }

    /** Call this in background; clears token locally. Call clearToken if you already cleared. */
    fun notifyServerLogout(token: String?) {
        if (token.isNullOrBlank()) return
        try {
            val req = Request.Builder()
                .url("$BASE/api/auth/logout")
                .post("".toRequestBody(JSON.toMediaType()))
                .addHeader("Authorization", "Bearer $token")
                .build()
            client.newCall(req).execute().close()
        } catch (_: Exception) {}
    }

    suspend fun replaceSession(email: String, password: String, context: Context): Result<LoginResponse> = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("email", email)
            put("password", password)
            put("role", "Lab")
            put("client", "tv")
            put("deviceName", deviceName())
        }.toString()
        val req = Request.Builder()
            .url("$BASE/api/auth/replace-session")
            .post(body.toRequestBody(JSON.toMediaType()))
            .addHeader("Content-Type", JSON)
            .build()
        runCatching {
            client.newCall(req).execute().use { r ->
                val str = r.body?.string() ?: ""
                if (!r.isSuccessful) {
                    val err = JSONObject(str).optString("error", "Replace session failed")
                    return@withContext Result.failure(Exception(err))
                }
                val json = JSONObject(str)
                val tok = json.getString("token")
                saveToken(context, tok)
                val user = json.getJSONObject("user")
                Result.success(
                    LoginResponse(
                        token = tok,
                        user = User(
                            id = user.getInt("id"),
                            email = user.getString("email"),
                            name = user.optString("name", ""),
                            role = user.getString("role")
                        )
                    )
                )
            }
        }.getOrElse { Result.failure(it) }
    }

    suspend fun getCourses(): Result<List<Course>> = withContext(Dispatchers.IO) {
        authGetArray("$BASE/api/courses") { arr ->
            List(arr.length()) { i ->
                val o = arr.getJSONObject(i)
                Course(o.getInt("id"), o.getString("name"), o.optString("description", ""))
            }
        }
    }

    suspend fun getLessons(courseId: Int): Result<List<Lesson>> = withContext(Dispatchers.IO) {
        authGetArray("$BASE/api/lessons/course/$courseId") { arr ->
            List(arr.length()) { i ->
                val o = arr.getJSONObject(i)
                Lesson(o.getInt("id"), o.getString("title"), o.optString("video_url", ""))
            }
        }
    }

    suspend fun getLesson(lessonId: Int): Result<LessonDetail> = withContext(Dispatchers.IO) {
        authGetObject("$BASE/api/lessons/$lessonId") { o ->
            val base = BASE.trimEnd('/')
            val raw = o.optString("videoUrl", null).takeIf { it != "null" && it.isNotEmpty() }
                ?: o.optString("video_url", null).takeIf { it != "null" && it.isNotEmpty() }
            val videoUrl = when {
                raw.isNullOrEmpty() -> ""
                raw.startsWith("http") -> raw
                else -> "$base$raw"
            }
            LessonDetail(
                id = o.getInt("id"),
                title = o.getString("title"),
                videoUrl = videoUrl
            )
        }
    }

    private suspend fun <T> authGetArray(url: String, parse: (JSONArray) -> T): Result<T> = withContext(Dispatchers.IO) {
        val t = token ?: return@withContext Result.failure(Exception("Not logged in"))
        val req = Request.Builder().url(url).get().addHeader("Authorization", "Bearer $t").build()
        client.newCall(req).execute().use { r ->
            val str = r.body?.string() ?: ""
            if (!r.isSuccessful) {
                if (r.code == 401) {
                    val obj = runCatching { JSONObject(str) }.getOrNull()
                    if (obj?.optString("code") == "SESSION_REPLACED") {
                        appContext?.let { clearToken(it) }
                        return@withContext Result.failure(Exception("SESSION_REPLACED"))
                    }
                }
                return@withContext Result.failure(Exception(JSONObject(str).optString("error", "Request failed")))
            }
            Result.success(parse(JSONArray(str)))
        }
    }

    private suspend fun <T> authGetObject(url: String, parse: (JSONObject) -> T): Result<T> = withContext(Dispatchers.IO) {
        val t = token ?: return@withContext Result.failure(Exception("Not logged in"))
        val req = Request.Builder().url(url).get().addHeader("Authorization", "Bearer $t").build()
        client.newCall(req).execute().use { r ->
            val str = r.body?.string() ?: ""
            if (!r.isSuccessful) {
                if (r.code == 401) {
                    val obj = runCatching { JSONObject(str) }.getOrNull()
                    if (obj?.optString("code") == "SESSION_REPLACED") {
                        appContext?.let { clearToken(it) }
                        return@withContext Result.failure(Exception("SESSION_REPLACED"))
                    }
                }
                return@withContext Result.failure(Exception(JSONObject(str).optString("error", "Request failed")))
            }
            Result.success(parse(JSONObject(str)))
        }
    }
}

data class LoginResponse(val token: String, val user: User)
data class User(val id: Int, val email: String, val name: String, val role: String)
data class Course(val id: Int, val name: String, val description: String)
data class Lesson(val id: Int, val title: String, val videoUrl: String)
data class LessonDetail(val id: Int, val title: String, val videoUrl: String)
