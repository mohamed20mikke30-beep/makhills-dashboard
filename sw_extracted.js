  <script>
// ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ù€ Service Worker Ù„ØªØ´ØºÙŠÙ„ Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ø®Ù„ÙÙŠØ©
if ('serviceWorker' in navigator && 'PushManager' in window) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('Service Worker registered successfully:', reg.scope);
      })
      .catch((err) => {
        console.warn('Service Worker registration failed:', err);
      });
  });
}

// Ø·Ù„Ø¨ Ø¥Ø°Ù† Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù…Ù† Ø§Ù„Ù‡Ø§ØªÙ ÙÙˆØ± ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission !== 'granted') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        console.log('ØªÙ… Ù…Ù†Ø­ Ø¥Ø°Ù† Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø¨Ù†Ø¬Ø§Ø­!');
      }
    });
  }
}

// Ø§Ø³ØªØ¯Ø¹Ø§Ø¡ Ø·Ù„Ø¨ Ø§Ù„Ø¥Ø°Ù† Ø¹Ù†Ø¯ ÙØªØ­ Ø§Ù„Ø´Ø§Ø´Ø©
document.addEventListener('DOMContentLoaded', requestNotificationPermission);
</script>
</body>
</html>
