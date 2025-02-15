require('dotenv').config();

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const mailOptions = {
    from: process.env.EMAIL_USER,
    to: 'alabilekanemmanuel@gmail.com',
    subject: `New Payment for SlamDunk`,
     html: `
       <h2>Payment Confirmation</h2>
       <p><strong>Event:</strong> SlamDunk</p>
       <p><strong>Name:</strong> Joshua</p>
       <p><strong>Email:</strong> joshau@gohangers.com</p>
       <p><strong>Items Purchased:</strong></p>
       <p><strong>Total Paid:</strong> £40</p>
     `,
};

transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
        return console.log('Error occurred: ', error);
    }
    console.log('Email sent: ', info.response);
});