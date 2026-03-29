document.addEventListener('DOMContentLoaded', () => {
  const modal = new bootstrap.Modal(
    document.getElementById('chatbotModal')
  );

  document.getElementById('btnChatbot').addEventListener('click', () => {
    modal.show();
  });

  document.getElementById('sendChat').addEventListener('click', async () => {
    const input = document.getElementById('chatInput');
    const msg = input.value;
    if (!msg) return;

    document.getElementById('chatBody').innerHTML += `
      <div class="text-end mb-2">
        <span class="badge bg-primary">${msg}</span>
      </div>
    `;

    input.value = '';

    const res = await fetch('/chatbot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });

    const data = await res.json();

    document.getElementById('chatBody').innerHTML += `
      <div class="text-start mb-2">
        <span class="badge bg-secondary">${data.reply}</span>
      </div>
    `;
  });
});
