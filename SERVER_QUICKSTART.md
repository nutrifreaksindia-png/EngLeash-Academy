# Quick: enable HTTPS for api.engleashacademy.in

Run as **root** on the server. No prompts.

---

## Copy script to server, then run (as root)

From your Mac:

```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy
scp scripts/server-setup-https.sh root@72.61.224.223:~/
```

On the server (SSH as root):

```bash
chmod +x ~/server-setup-https.sh
~/server-setup-https.sh
```

Test from your Mac:

```bash
curl -I https://api.engleashacademy.in/api/health
```

---

## If something fails

Paste the full output of the failing command and I’ll use it to fix. For example:

- Certbot fails → paste: `certbot --nginx -d api.engleashacademy.in --non-interactive --agree-tos --register-unsafely-without-email 2>&1`
- 502 / site not loading → paste: `curl -I https://api.engleashacademy.in/api/health 2>&1` and (on server) `ss -tlnp | grep 3001`
