package com.engleash.academy.tv

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Api.init(applicationContext)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (supportFragmentManager.backStackEntryCount > 0) {
                    supportFragmentManager.popBackStack()
                } else {
                    val current = supportFragmentManager.findFragmentById(R.id.container)
                    if (current is CourseListFragment) {
                        // Stay logged in; only explicit Log out button logs out
                        return
                    }
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
        if (Api.token != null) {
            showMain()
        } else {
            setContentView(R.layout.activity_main)
            supportFragmentManager.beginTransaction()
                .replace(R.id.container, LoginFragment())
                .commit()
        }
    }

    fun onLoginSuccess() {
        runOnUiThread { showMain() }
    }

    private fun showMain() {
        setContentView(R.layout.activity_main)
        supportFragmentManager.beginTransaction()
            .replace(R.id.container, CourseListFragment())
            .commit()
    }

    fun showLessons(courseId: Int, courseName: String) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.container, LessonListFragment.newInstance(courseId, courseName))
            .addToBackStack(null)
            .commit()
    }

    fun playVideo(lessonId: Int, title: String, videoUrl: String) {
        if (videoUrl.isBlank()) {
            Toast.makeText(this, "No video for this lesson", Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_TITLE, title)
            putExtra(PlayerActivity.EXTRA_VIDEO_URL, videoUrl)
        })
    }

    fun logout() {
        val t = Api.token
        Api.clearToken(this)
        supportFragmentManager.beginTransaction()
            .replace(R.id.container, LoginFragment())
            .commitAllowingStateLoss()
        lifecycleScope.launch(Dispatchers.IO) {
            Api.notifyServerLogout(t)
        }
    }

    /** Call when API returns 401 SESSION_REPLACED (logged in elsewhere). */
    fun sessionReplaced() {
        Api.clearToken(this)
        supportFragmentManager.beginTransaction()
            .replace(R.id.container, LoginFragment())
            .commitAllowingStateLoss()
        Toast.makeText(this, "You were logged out because you signed in on another device.", Toast.LENGTH_LONG).show()
    }
}
