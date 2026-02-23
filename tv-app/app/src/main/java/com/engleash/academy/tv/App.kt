package com.engleash.academy.tv

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Api.init(this)
    }
}
