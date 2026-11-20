(() => {
  if (window.__customWhatsappOtpInstalled) return;
  window.__customWhatsappOtpInstalled = true;

  let currentOtp = null;
  let currentOtpExpiry = 0;

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";

    // ১. OTP তৈরি ও সরাসরি WhatsApp-এ ওপেন করা
    if (url.includes("/api/whatsapp-otp/request")) {
      let body = {};
      try {
        body = init.body ? JSON.parse(init.body) : {};
      } catch {}

      const rawDigits = String(body.phone || body.mobile || body.number || "").replace(/\D/g, "");
      if (rawDigits.length < 10) {
        return new Response(
          JSON.stringify({ error: "Please enter a valid 10-digit mobile number."}),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const fullPhone = rawDigits.length === 10 ? "91" + rawDigits : rawDigits;
      currentOtp = String(Math.floor(100000 + Math.random() * 900000));
      currentOtpExpiry = Date.now() + 5 * 60 * 1000;

      const message =
        `Tata Power Solar Application Verification Code: ${currentOtp}\n\n` +
        `Please enter this code on the form to complete registration.`;

      const whatsappUrl =
        `https://api.whatsapp.com/send/?phone=${fullPhone}` +
        `&text=${encodeURIComponent(message)}&type=phone_number&app_absent=0`;

      window.open(whatsappUrl, "_blank", "noopener,noreferrer");

      return new Response(
        JSON.stringify({
          ok: true,
          sent: true,
          phone: fullPhone,
          expiresInSeconds: 300,
          message: "OTP has been opened on WhatsApp. Copy the code and paste it below."
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // ২. ইউজারের দেওয়া OTP যাচাই করা
    if (url.includes("/api/whatsapp-otp/verify")) {
      let body = {};
      try {
        body = init.body ? JSON.parse(init.body) : {};
      } catch {}

      const enteredCode = String(body.code || body.otp || "").trim();
      if (!currentOtp || Date.now() > currentOtpExpiry) {
        return new Response(
          JSON.stringify({ error: "OTP has expired. Please send a new OTP." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      if (enteredCode !== currentOtp) {
        return new Response(
          JSON.stringify({ error: "Incorrect OTP entered. Enter the correct 6-digit code from WhatsApp." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      currentOtp = null;
      return new Response(
        JSON.stringify({ ok: true, verified: true, message: "WhatsApp Verification was successful." }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return origFetch(input, init);
  };
})();
