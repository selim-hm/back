const nodemailer = require("nodemailer");

class EmailService {
  constructor() {
    this.transporter = null;
    this.maxRetries = 3;
    this.retryDelay = 1000;
    this.timeout = 10000;
    this.initializeTransporter();
  }

  initializeTransporter() {
    this.transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL,
        pass: process.env.PASSWORD,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
    });

    this.transporter.verify((error) => {
      if (error) {
        console.error("Email transporter verification failed:", error.message);
      }
    });
  }

  async sendMail({ to, subject, text, html, attachments = [] }) {
    const mailOptions = {
      from: {
        name: process.env.EMAIL_NAME || "appsligo",
        address: process.env.EMAIL,
      },
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      text: text,
      html: html,
      attachments: attachments,
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        Importance: "high",
      },
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const info = await Promise.race([
          this.transporter.sendMail(mailOptions),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Email sending timeout")),
              this.timeout,
            ),
          ),
        ]);
        return {
          success: true,
          info,
          attempt: attempt,
        };
      } catch (error) {
        console.error(
          `Email sending attempt ${attempt} failed:`,
          error.message,
        );

        if (attempt === this.maxRetries) {
          await this.handleFailure({ to, subject, error });
          return {
            success: false,
            error: error.message,
            attempts: attempt,
          };
        }

        await this.delay(this.retryDelay * attempt);

        if (error.code === "EAUTH" || error.code === "EENVELOPE") {
          this.initializeTransporter();
        }
      }
    }
  }

  async sendVerificationEmail({ to, verificationCode, username }) {
    const subject = "Verify Your Email - appsligo";
    const text = `Your verification code is: ${verificationCode}`;
    const html = this.generateVerificationTemplate(verificationCode, username);

    return await this.sendMail({
      to,
      subject,
      text,
      html,
    });
  }

  async sendPasswordResetEmail({ to, resetToken, username }) {
    const subject = "Password Reset Request - appsligo";
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const html = this.generatePasswordResetTemplate(resetLink, username);

    return await this.sendMail({
      to,
      subject,
      html,
      text: `Click here to reset your password: ${resetLink}`,
    });
  }

  generateVerificationTemplate(code, username) {
    return `
       <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>appsilgo- Password Reset Request</title>
    <style>
        /* Reset and Base Styles */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1e293b;
            background-color: #f8fafc;
            padding: 20px 0;
        }
        
        /* Container */
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        }
        
        /* Header */
        .email-header {
            background: linear-gradient(135deg, #059669 0%, #047857 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
        }
        
        .email-header h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
            letter-spacing: -0.5px;
        }
        
        .email-header p {
            font-size: 16px;
            opacity: 0.9;
            font-weight: 400;
        }
        
        /* Content */
        .email-content {
            padding: 40px 30px;
        }
        
        .greeting {
            font-size: 18px;
            margin-bottom: 20px;
            color: #1e293b;
            font-weight: 500;
        }
        
        .message {
            margin-bottom: 25px;
            color: #475569;
            font-size: 16px;
        }
        
        /* Button */
        .button-container {
            text-align: center;
            margin: 35px 0;
        }
        
        .reset-button {
            background-color: #3b82f6;
            color: white;
            padding: 16px 36px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            display: inline-block;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
        }
        
        .reset-button:hover {
            background-color: #2563eb;
            transform: translateY(-2px);
            box-shadow: 0 6px 15px rgba(59, 130, 246, 0.4);
        }
        
        /* Link Box */
        .link-container {
            margin: 30px 0;
        }
        
        .link-box {
            background: #f8fafc;
            padding: 18px;
            border: 1px solid #e2e8f0;
            border-left: 4px solid #3b82f6;
            border-radius: 8px;
            word-break: break-all;
            font-family: monospace;
            font-size: 14px;
            color: #475569;
        }
        
        /* Security Note */
        .security-note {
            background-color: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 8px;
            padding: 18px;
            margin-top: 30px;
            color: #991b1b;
            font-size: 14px;
            font-weight: 500;
        }
        
        .security-note p {
            margin-bottom: 10px;
        }
        
        .security-note p:last-child {
            margin-bottom: 0;
        }
        
        /* Footer */
        .email-footer {
            background: #f0fdf4;
            padding: 30px;
            text-align: center;
            color: #64748b;
            border-top: 1px solid #dcfce7;
        }
        
        .footer-text {
            margin-bottom: 15px;
            font-size: 14px;
        }
        
        .copyright {
            font-size: 13px;
            opacity: 0.8;
        }
        
        .company-logo {
            margin-bottom: 20px;
            font-weight: 700;
            font-size: 20px;
            color: #059669;
        }
        
        /* Dark Mode Support */
        @media (prefers-color-scheme: dark) {
            body {
                background-color: #0f172a;
            }
            
            .email-container {
                background-color: #1e293b;
                color: #e2e8f0;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
            }
            
            .email-content {
                color: #e2e8f0;
            }
            
            .greeting {
                color: #f1f5f9;
            }
            
            .message {
                color: #cbd5e1;
            }
            
            .link-box {
                background: #334155;
                border-color: #475569;
                color: #e2e8f0;
            }
            
            .email-footer {
                background: #064e3b;
                color: #d1fae5;
                border-top-color: #047857;
            }
        }
        
        /* Responsive Design */
        @media (max-width: 600px) {
            .email-container {
                border-radius: 0;
                box-shadow: none;
            }
            
            .email-header {
                padding: 30px 20px;
            }
            
            .email-header h1 {
                font-size: 24px;
            }
            
            .email-content {
                padding: 30px 20px;
            }
            
            .reset-button {
                padding: 14px 28px;
                font-size: 15px;
                width: 100%;
                text-align: center;
            }
            
            .email-footer {
                padding: 25px 20px;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="email-header">
            <h1>Password Reset Request</h1>
            <p>Secure your appsilgoaccount</p>
        </div>
        
        <div class="email-content">
            <p class="greeting">Dear ${username},</p>
            
            <p class="message">
                We received a request to reset the password for your appsilgoaccount. 
                To complete this process and set a new password, please click the secure button below:
            </p>
            
            <div class="button-container">
                <a href="${resetLink}" class="reset-button">Reset Your Password</a>
            </div>
            
            <div class="link-container">
                <p class="message">
                    If the button above doesn't work, you can copy and paste the following link into your web browser:
                </p>
                
                <div class="link-box">
                    ${resetLink}
                </div>
            </div>
            
            <div class="security-note">
                <p><strong>Security Note:</strong> For your protection, this link is only valid for <strong>1 hour</strong>. After this time, you will need to submit a new reset request.</p>
                <p>⚠️ If you did not request a password reset, please ignore this email. Your current password will remain secure and unchanged.</p>
            </div>
        </div>
        
        <div class="email-footer">
            <div class="company-logo">Wayzon</div>
            <p class="footer-text">This is an automated security notification from Wayzon.</p>
            <p class="copyright">&copy; ${new Date().getFullYear()} Wayzon. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `;
  }

  generatePasswordResetTemplate(resetLink, username) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>appsilgo- Password Reset Request</title>
        <style>
            /* Reset and Base Styles */
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;
                color: #1e293b;
                background-color: #f8fafc;
                padding: 20px 0;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
            }
            
            /* Container */
            .container {
                max-width: 600px;
                margin: 0 auto;
                background-color: #ffffff;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
            }
            
            /* Header */
            .header {
                background: linear-gradient(135deg, #059669 0%, #047857 100%);
                color: white;
                padding: 40px 30px;
                text-align: center;
                position: relative;
            }
            
            .header::before {
                content: "🔑";
                font-size: 48px;
                display: block;
                margin-bottom: 15px;
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
            }
            
            .header h1 {
                font-size: 28px;
                font-weight: 700;
                margin-bottom: 8px;
                letter-spacing: -0.5px;
            }
            
            .header p {
                font-size: 16px;
                opacity: 0.9;
                font-weight: 400;
            }
            
            /* Content */
            .content {
                padding: 40px 30px;
            }
            
            .greeting {
                font-size: 18px;
                margin-bottom: 20px;
                color: #1e293b;
                font-weight: 600;
            }
            
            .message {
                margin-bottom: 25px;
                color: #475569;
                font-size: 16px;
            }
            
            /* Button */
            .button-container {
                text-align: center;
                margin: 35px 0;
            }
            
            .button {
                background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                color: white;
                padding: 16px 36px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                font-size: 16px;
                display: inline-block;
                box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
                transition: all 0.3s ease;
                border: none;
                cursor: pointer;
                min-width: 200px;
            }
            
            .button:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 15px rgba(59, 130, 246, 0.4);
                background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
            }
            
            /* Link Box */
            .link-container {
                margin: 30px 0;
            }
            
            .link-box {
                background: #f8fafc;
                padding: 18px;
                border: 1px solid #e2e8f0;
                border-left: 4px solid #3b82f6;
                border-radius: 8px;
                word-break: break-all;
                font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
                font-size: 14px;
                color: #475569;
                line-height: 1.5;
            }
            
            /* Security Note */
            .security-note {
                background-color: #fef2f2;
                border: 1px solid #fecaca;
                border-radius: 8px;
                padding: 20px;
                margin-top: 30px;
                color: #991b1b;
                font-size: 14px;
                font-weight: 500;
                border-left: 4px solid #dc2626;
            }
            
            .security-note p {
                margin-bottom: 12px;
                display: flex;
                align-items: flex-start;
                gap: 8px;
            }
            
            .security-note p:last-child {
                margin-bottom: 0;
            }
            
            .warning-icon {
                font-size: 16px;
                flex-shrink: 0;
                margin-top: 2px;
            }
            
            /* Footer */
            .footer {
                background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
                padding: 30px;
                text-align: center;
                color: #64748b;
                border-top: 1px solid #bbf7d0;
            }
            
            .footer-text {
                margin-bottom: 15px;
                font-size: 14px;
                opacity: 0.9;
            }
            
            .copyright {
                font-size: 13px;
                opacity: 0.8;
            }
            
            .company-logo {
                font-weight: 700;
                font-size: 20px;
                color: #059669;
                margin-bottom: 15px;
                letter-spacing: -0.5px;
            }
            
            /* Dark Mode Support */
            @media (prefers-color-scheme: dark) {
                body {
                    background-color: #0f172a;
                }
                
                .container {
                    background-color: #1e293b;
                    color: #e2e8f0;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
                }
                
                .content {
                    color: #e2e8f0;
                }
                
                .greeting {
                    color: #f1f5f9;
                }
                
                .message {
                    color: #cbd5e1;
                }
                
                .link-box {
                    background: #334155;
                    border-color: #475569;
                    color: #e2e8f0;
                }
                
                .security-note {
                    background: #7f1d1d;
                    border-color: #dc2626;
                    color: #fecaca;
                }
                
                .footer {
                    background: linear-gradient(135deg, #064e3b 0%, #047857 100%);
                    color: #d1fae5;
                    border-top-color: #059669;
                }
            }
            
            /* Responsive Design */
            @media (max-width: 620px) {
                body {
                    padding: 10px;
                }
                
                .container {
                    border-radius: 8px;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                }
                
                .header {
                    padding: 30px 20px;
                }
                
                .header::before {
                    font-size: 40px;
                }
                
                .header h1 {
                    font-size: 24px;
                }
                
                .header p {
                    font-size: 15px;
                }
                
                .content {
                    padding: 30px 20px;
                }
                
                .button {
                    padding: 14px 28px;
                    font-size: 15px;
                    width: 100%;
                    max-width: 280px;
                    text-align: center;
                }
                
                .footer {
                    padding: 25px 20px;
                }
                
                .link-box {
                    font-size: 13px;
                    padding: 15px;
                }
            }
            
            /* Print Styles */
            @media print {
                body {
                    background: white !important;
                    padding: 0 !important;
                }
                
                .container {
                    box-shadow: none !important;
                    border: 1px solid #ddd !important;
                }
                
                .button {
                    background: #000 !important;
                    color: white !important;
                    box-shadow: none !important;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Password Reset Request</h1>
                <p>Secure your appsilgoaccount</p>
            </div>
            
            <div class="content">
                <p class="greeting">Dear ${username},</p>
                
                <p class="message">
                    We received a request to reset the password for your appsilgoaccount. 
                    To complete this process and set a new password, please click the secure button below:
                </p>
                
                <div class="button-container">
                    <a href="${resetLink}" class="button">Reset Your Password</a>
                </div>
                
                <div class="link-container">
                    <p class="message">
                        If the button above doesn't work, you can copy and paste the following link into your web browser:
                    </p>
                    
                    <div class="link-box">
                        ${resetLink}
                    </div>
                </div>
                
                <div class="security-note">
                    <p>
                        <span class="warning-icon">⏱️</span>
                        <strong>Security Note:</strong> For your protection, this link is only valid for <strong>1 hour</strong>. After this time, you will need to submit a new reset request.
                    </p>
                    <p>
                        <span class="warning-icon">⚠️</span>
                        If you did not request a password reset, please ignore this email. Your current password will remain secure and unchanged.
                    </p>
                </div>
            </div>
            
            <div class="footer">
                <div class="company-logo">Wayzon</div>
                <p class="footer-text">This is an automated security notification from Wayzon.</p>
                <p class="copyright">&copy; ${new Date().getFullYear()} Wayzon. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  async handleFailure({ to, subject, error }) {
    console.error(`Email sending failed for ${to}: ${error.message}`);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      maxRetries: this.maxRetries,
      timeout: this.timeout,
      retryDelay: this.retryDelay,
      pool: this.transporter ? true : false,
    };
  }

  async close() {
    if (this.transporter) {
      this.transporter.close();
    }
  }
}

// Singleton instance
const emailService = new EmailService();

// Cleanup on process exit
process.on("SIGTERM", async () => {
  await emailService.close();
});

process.on("SIGINT", async () => {
  await emailService.close();
});

module.exports = emailService;
