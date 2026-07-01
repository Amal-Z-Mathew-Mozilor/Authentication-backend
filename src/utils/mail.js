import Mailgen from "mailgen"
import nodemailer from "nodemailer"
import "dotenv/config"
const emailVerification=(username,verificationurl)=>
{
    return{
     body: {
        name: username,
        intro: 'Welcome to Pulse! We\'re very excited to have you on board.',
        action: {
            instructions: 'To get started with Us, please Verify your eamil:',
            button: {
                color: '#22BC66', 
                text: 'Verify',
                link: verificationurl
            }
        },
        outro: 'Need help, or have questions? Just reply to this email, we\'d love to help.'
       }
    }
}
const passwordResetVerification=(username,verificationurl)=>
{
    return{
     body: {
        name: username,
        intro: 'To reset Your Password Verify your email first',
        action: {
            instructions: 'Click the button to verify your mail:',
            button: {
                color: '#22BC66', 
                text: 'Verify',
                link: verificationurl
            }
        },
        outro: 'Need help, or have questions? Just reply to this email, we\'d love to help.'
       }
    }
}
const sendEmail =async function(options)
{
    const mailGenerator = new Mailgen({
    theme: 'default',
    product: {
        name: 'Pulse',
        link: 'http://localhost:5173/'
    }
    });
   const  textEmail=mailGenerator.generatePlaintext(options.emailContent)
    const htmlEmail=mailGenerator.generate(options.emailContent)

    const transport = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD
    }
    });
    const mail={
        from:"mail.pulse@example.com",
        to:options.email,
        subject:options.subject,
        text:textEmail,
        html:htmlEmail
    }
    try{
        await transport.sendMail(mail)
    }catch(err)
    {
        console.log(err)
    }
}
export{emailVerification,passwordResetVerification,sendEmail}