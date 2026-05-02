package com.engleash.academy.tv

import android.app.AlertDialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class LoginFragment : Fragment() {
    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        return inflater.inflate(R.layout.fragment_login, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        view.findViewById<View>(R.id.signIn).setOnClickListener {
            val email = view.findViewById<android.widget.EditText>(R.id.email).text.toString().trim()
            val password = view.findViewById<android.widget.EditText>(R.id.password).text.toString()
            if (email.isEmpty() || password.isEmpty()) {
                Toast.makeText(requireContext(), "Enter email and password", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            viewLifecycleOwner.lifecycleScope.launch {
                Api.login(email, password, requireContext()).fold(
                    onSuccess = { result ->
                        when (result) {
                            is LoginResult.Success -> (activity as? MainActivity)?.onLoginSuccess()
                            is LoginResult.AlreadyLoggedIn -> showAlreadyLoggedInDialog(view, email, password, result.deviceName)
                        }
                    },
                    onFailure = { Toast.makeText(requireContext(), it.message ?: "Login failed", Toast.LENGTH_LONG).show() }
                )
            }
        }
    }

    private fun showAlreadyLoggedInDialog(view: View, email: String, password: String, deviceName: String) {
        AlertDialog.Builder(requireContext())
            .setTitle("Already logged in")
            .setMessage("Already logged in on another device: $deviceName. Do you want to log out from $deviceName and sign in here?")
            .setPositiveButton("Yes, sign in here") { _, _ ->
                viewLifecycleOwner.lifecycleScope.launch {
                    Api.replaceSession(email, password, requireContext()).fold(
                        onSuccess = { (activity as? MainActivity)?.onLoginSuccess() },
                        onFailure = { Toast.makeText(requireContext(), it.message ?: "Failed", Toast.LENGTH_LONG).show() }
                    )
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
