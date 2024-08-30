const express = require('express');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const csv = require('csv-parser');
const fs = require('fs');
const cors = require('cors');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const path = require('path');
const { inspect } = require('util');
const readline = require('readline');
const app = express();
const port = 3000;

app.use(cors());
app.set('view engine', 'ejs');
app.set('views', './');

// Get CSV file path for the current user
const getCsvFilePath = (user) => {
  if (!user || user === 'default') {
    return 'default.csv';
  }
  return `${user}.csv`; // Ensure this resolves to the correct path
};

// Read CSV file based on the current user
const readCsv = (user) => {
  const filePath = getCsvFilePath(user);
  console.log(`Reading CSV from path: ${filePath}`); // Debug: Print file path
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`); // Debug: Print error if file is missing
      return resolve([]); // Resolve with an empty array if file is not found
    }
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(`Error reading CSV file: ${err}`));
  });
};
//console.log(readCsv(""))
/*
const kak = async () => {
const csvData = await readCsv("dev");
return csvData};

kak().then((csvData) => {
  if (csvData) {
    for (let row of csvData) {
      console.log(row);
    }
  }
});*/
// Update CSV file based on the current user
const updateCsvFile = (user, csvData) => {
  const filePath = getCsvFilePath(user);
  const newCsv = stringify(csvData, { header: true });
  fs.writeFileSync(filePath, newCsv);
};
const getTodayDate = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set time to the start of today
  return today;
};

// Function to fetch emails from a specific folder
const fetchEmailsco = (imap, boxName, callback) => {
  imap.openBox(boxName, true, function (err, box) {
    if (err) {
      console.error(`Error opening ${boxName}:`, err);
      return callback(0); // Callback with 0 emails if there's an error
    }

    imap.search(['ALL'], function (err, results) {
      if (err) {
        console.error(`Error searching emails in ${boxName}:`, inspect(err, { depth: null }));
        return callback(0); // Callback with 0 emails if there's an error
      }

      if (!results || !results.length) {
        console.log(`No emails found in ${boxName}`);
        return callback(0); // Callback with 0 emails if no results
      }

      const todayDate = getTodayDate();
      let todayEmailsCount = 0;
      const fetchOptions = { bodies: 'HEADER.FIELDS (DATE)', struct: false };

      const f = imap.fetch(results, fetchOptions);

      f.on('message', function (msg, seqno) {
        msg.on('body', function (stream, info) {
          let buffer = '';
          stream.on('data', function (chunk) {
            buffer += chunk.toString('utf8');
          });
          stream.once('end', function () {
            const emailDateMatch = buffer.match(/Date:\s*(.+)/i);
            if (emailDateMatch) {
              const emailDate = new Date(emailDateMatch[1]);
              if (emailDate >= todayDate) {
                todayEmailsCount++;
              }
            }
          });
        });
      });

      f.once('error', function (err) {
        console.log('Fetch error: ' + err);
      });

      f.once('end', function () {
        //console.log(`Found ${todayEmailsCount} emails in ${boxName} for today.`);
        callback(todayEmailsCount);
      });
    });
  });
};

// Function to get email counts for a user
const getEmailCounts = async (user, password) => {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: user,
      password: password,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false } // Allow self-signed certificates
    });

    imap.once('ready', function () {
      let emailCounts = { inbox: 0, spam: 0 };

      fetchEmailsco(imap, 'INBOX', function (inboxCount) {
        emailCounts.inbox = inboxCount;

        fetchEmailsco(imap, '[Gmail]/Spam', function (spamCount) {
          emailCounts.spam = spamCount;

          imap.end(); // Close connection after fetching counts

          resolve(emailCounts); // Resolve with the counts
        });
      });
    });

    imap.once('error', function (err) {
      console.log('IMAP error:', inspect(err, { depth: null }));
      reject(err); // Reject if there's an error
    });

    imap.connect();
  });
};

// Function to get user credentials from the CSV file
const getUserCredentials = async (filename) => {
  const filePath = path.join(__dirname, `${filename}.csv`);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return []; // Return an empty array if the file does not exist
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  const credentials = [];

  for await (const line of rl) {
    // Skip the header line (email,password)
    if (line.startsWith('email,password')) continue;

    const [user, password] = line.split(',');
    if (user && password) {
      credentials.push({ user: user.trim(), password: password.trim() });
    }
  }

  return credentials; // Return the array of credentials
};

// Route to get email counts for a specific user
app.get('/json', async (req, res) => {
  const filename = req.query.user; // Filename of the CSV file

  if (!filename) {
    return res.status(400).json({ error: 'Filename is required' });
  }

  try {
    const userCredentialsList = await getUserCredentials(filename);
    //console.log(userCredentialsList)
    if (userCredentialsList.length === 0) {
      return res.status(404).json({ error: `No credentials found in file: ${filename}` });
    }

    // Process all user credentials concurrently
    const results = await Promise.all(userCredentialsList.map(async ({ user, password }) => {
      try {
        const emailCounts = await getEmailCounts(user, password);
        return {
          user,
          total: emailCounts.inbox + emailCounts.spam,
          inbox: emailCounts.inbox,
          spam: emailCounts.spam
        };
      } catch (error) {
        console.error(`Error fetching emails for ${user}:`, error);
        return {
          user,
          total: 'Error',
          inbox: 'Error',
          spam: 'Error'
        };
      }
    }));

    // Aggregate totals
    const totalInbox = results.reduce((sum, result) => sum + (typeof result.inbox === 'number' ? result.inbox : 0), 0);
    const totalSpam = results.reduce((sum, result) => sum + (typeof result.spam === 'number' ? result.spam : 0), 0);

    // Pass the totals and results to the view
    res.render('view', { results, totalInbox, totalSpam });
  } catch (error) {
    console.error(`Error processing file ${filename}:`, error);
    res.status(500).json({ error: 'Failed to process the file' });
  }
});



// Function to process email counts for a user
const processEmailCounts = async ({ user, password }) => {
  try {
    const emailCounts = await getEmailCounts(user, password);
    return {
      user,
      total: emailCounts.inbox + emailCounts.spam,
      inbox: emailCounts.inbox,
      spam: emailCounts.spam
    };
  } catch (error) {
    console.error(`Error fetching emails for ${user}:`, error);
    return {
      user,
      total: 'Error',
      inbox: 'Error',
      spam: 'Error'
    };
  }
};

// Fetch emails for a specific user and folder
const fetchEmailsForUser = async (imapConfig, folder) => {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: imapConfig.user,
      password: imapConfig.password,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false } // Allow self-signed certificates
    });
   console.log(imapConfig.user,imapConfig.password)
    imap.once('error', (err) => {
      console.error(`IMAP Error for user ${imapConfig.user}: ${err.message}`);
      console.warn(`Skipping user ${imapConfig.user} due to error.`);
      resolve([]); // Resolve with an empty array if there's an error
    });

    imap.once('ready', () => {
      imap.openBox(folder, false, (err, box) => {
        if (err) {
          console.error(`Error opening box for user ${imapConfig.user}: ${err.message}`);
          imap.end();
          resolve([]); // Resolve with an empty array if opening box fails
          return;
        }

        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const formattedDate = tenMinutesAgo.toUTCString().slice(0, 16);

        imap.search([['SINCE', formattedDate]], (err, results) => {
          if (err) {
            console.error(`Error searching emails for user ${imapConfig.user}: ${err.message}`);
            imap.end();
            resolve([]); // Resolve with an empty array if searching fails
            return;
          }

          if (results.length === 0) {
            imap.end();
            resolve([]); // Resolve with an empty array if no emails found
            return;
          }

          const fetch = imap.fetch(results, { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)', 'TEXT'] });
          const emails = [];

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) {
                  console.error(`Error parsing email for user ${imapConfig.user}: ${err.message}`);
                  return;
                }

                const timeAgo = getTimeAgo(parsed.date);
                if (parsed.subject && parsed.date >= tenMinutesAgo) {
                  emails.push({
                    subject: parsed.subject,
                    from: parsed.from?.value?.[0]?.address || 'Unknown Sender',
                    timeAgo: timeAgo,
                    receivedTime: parsed.date ? parsed.date.toISOString() : 'Unknown'
                  });
                }
              });
            });

            msg.once('end', () => {
              console.log(`Fetched message for user ${imapConfig.user}.`);
            });
          });

          fetch.once('end', () => {
            imap.end();
            resolve(emails); // Resolve with fetched emails
          });

          fetch.once('error', (err) => {
            console.log(`Error fetching emails for user ${imapConfig.user}: ${err.message}`);
            imap.end();
            resolve([]); // Resolve with an empty array if fetching fails
          });
        });
      });
    });

    imap.connect();
  });
};


// Helper function to calculate time ago
const getTimeAgo = (date) => {
  if (!date) return 'Unknown';

  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);

  if (diffInDays > 0) return `${diffInDays} day(s) ago`;
  if (diffInHours > 0) return `${diffInHours} hour(s) ago`;
  if (diffInMinutes > 0) return `${diffInMinutes} minute(s) ago`;
  return `${diffInSeconds} second(s) ago`;
};

// Create a user-specific cache object
const userCaches = {};

// Fetch emails for all users
const fetchEmails = async (folders, user) => {
  try {
    // Read user-specific CSV file
    const csvData = await readCsv(user);

    // If CSV data is empty, return an empty array
    if (csvData.length === 0) {
      console.log(`CSV data for ${user} is empty, returning empty response.`);
      return [];
    }

    const imapConfigs = csvData.map((row) => ({
      user: row.email,
      password: row.password
    }));

    const allEmails = await Promise.all(
      imapConfigs.map(async (config) => {
        const userEmails = await Promise.all(
          folders.map(async (folder) => {
            const emails = await fetchEmailsForUser(config, folder);
            return {
              user: config.user,
              folder: folder,
              username: user, // Add the username for filtering
              emails: emails
            };
          })
        );
        return userEmails;
      })
    );
    return allEmails.flat();
  } catch (error) {
    console.log(`Error fetching emails: ${error.message}`);
    return [];
  }
};

const folders = ['INBOX', '[Gmail]/Spam'];
const cacheDuration = 40 * 1000;

// Update emails endpoint
const updateEmails = async (req, res) => {
  try {
    const user = req.query.user || 'default'; // Use 'default' as fallback if user is not provided
    const now = Date.now();

    // Initialize cache for the user if it doesn't exist
    if (!userCaches[user]) {
      userCaches[user] = {
        cachedEmails: [],
        lastFetchTime: 0,
      };
    }

    const userCache = userCaches[user];

    if (now - userCache.lastFetchTime < cacheDuration && userCache.cachedEmails.length > 0) {
      return res.json({
        emailData: userCache.cachedEmails,
        hasEmails: userCache.cachedEmails.some(data => data.emails.length > 0)
      });
    }

    const emailData = await fetchEmails(folders, user);
    userCache.cachedEmails = emailData;
    userCache.lastFetchTime = now;

    res.json({
      emailData,
      hasEmails: emailData.some(data => data.emails.length > 0)
    });
  } catch (error) {
    console.error(`Error in updateEmails: ${error.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Form route
app.get('/form', (req, res) => {
  try {
    const user = req.query.user || 'default'; // Default to 'default' if user parameter is not provided
    res.render('form', { user: user });
  } catch (error) {
    console.error(`Error in /form route: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

// Dashboard route
app.get('/dashboard', async (req, res) => {
  try {
    const user = req.query.user || 'default'; // Default to 'default' if user parameter is not provided
    console.log(`Dashboard request for user: ${user}`); // Debug: Print the user parameter

    const emailData = await fetchEmails(folders, user);

    // Check if the data for the requested user is empty
    if (emailData.length === 0) {
      console.log(`No emails found for user: ${user}`);
    }

    // Render the dashboard with user-specific email data
    res.render('dashboard', { emailData });
  } catch (error) {
    console.error(`Error in /dashboard route: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

// Insert route
app.post('/insert', express.json(), async (req, res) => {
  const { user, password, users } = req.body;

  if (!user || !password || !users) {
    return res.status(400).json({ error: 'User, password, and users parameters are required.' });
  }

  try {
    // Determine the CSV file path based on the users parameter
    const filePath = getCsvFilePath(users);
    let csvData = [];

    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath);
      csvData = parse(fileContent, { columns: true, skip_empty_lines: true });
    }

    const userExists = csvData.some(row => row.email === user);
    if (userExists) {
      return res.status(400).json({ error: 'User already exists.' });
    }

    // Add new user to the CSV data
    csvData.push({ email: user, password: password });
    updateCsvFile(users, csvData); // Save to user-specific CSV file

    res.status(200).json({ message: 'User added successfully.' });
  } catch (error) {
    console.error(`Error in /insert route: ${error.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API endpoint to get emails
app.get('/api/emails', updateEmails);

// Global error handler
app.use((err, req, res, next) => {
  console.error(`Global Error: ${err.message}`);
  res.status(500).send('Internal Server Error');
});

app.get('/delete', (req, res) => {
  const user = req.query.user || 'default'; // Default to 'default' if user parameter is not provided
  const filePath = getCsvFilePath(user);

  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error(`Error deleting file for user ${user}: ${err.message}`);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      console.log(`Deleted file for user ${user}: ${filePath}`);
      return res.status(200).json({ message: `File for user ${user} deleted successfully.` });
    });
  } else {
    console.log(`File for user ${user} does not exist: ${filePath}`);
    return res.status(404).json({ error: `File for user ${user} not found.` });
  }
});
const csvDirectory = path.join(__dirname, ".");

app.get('/dhakamirpurdhaka', (req, res) => {
  const csvDirectory = path.join(__dirname, ".");
  fs.readdir(csvDirectory, (err, files) => {
    if (err) {
      return res.status(500).send('Failed to read directory');
    }

    const csvFiles = files.filter(file => path.extname(file) === '.csv');

    const fileList = csvFiles.map(file => {
      return `
        <li>
          ${file} -    
          <a style='margin:40px' href="/edit/${file}">Edit</a> 
          <a href="/remove/${file}" onclick="return confirm('Are you sure you want to delete this file?');">Delete</a>
        </li>
      `;
    }).join('');

    const html = `
      <h1>CSV Files</h1>
      <ul>
        ${fileList}
      </ul>
    `;

    res.send(html);
  });
});
// Handle form submission to update the CSV file
app.get('/edit/:file', (req, res) => {
  const filename = req.params.file;
  const filePath = path.join(__dirname, filename);

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).send('Failed to read file');
    }

    const html = `
      <h1 style='margin:10px;'>Edit ${filename}</h1>
      <form action="/edit/${filename}" method="POST">
        <textarea name="content" rows="20" cols="80">${data}</textarea><br>
        <button type="submit">Save</button>
      </form>
      <a href="/">Back to list</a>
    `;

    res.send(html);
  });
});
app.use(express.urlencoded({ extended: true }));
// Handle form submission to update the CSV file


app.post('/edit/:file', (req, res) => {
  const filename = req.params.file;
  const filePath = path.join(__dirname, filename);
  let content = req.body.content || '';

  // Decode URL-encoded content
  content = decodeURIComponent(content);

  // Split content into lines and trim whitespace
  const lines = content.split('\n').map(line => line.trim()).filter(line => line !== '');
  
  // Validate the CSV format
  const invalidLines = [];
  lines.forEach((line, index) => {
    // Skip the header line (index 0)
    if (index === 0) return;

    const [email, password] = line.split(',');
    if (!email || !password || !/\S+@\S+\.\S+/.test(email)) {
      invalidLines.push(index + 1); // Store 1-based index of invalid lines
    }
  });

  // If there are invalid lines, return an error message
  if (invalidLines.length > 0) {
    return res.status(400).send(`Invalid CSV format on lines: ${invalidLines.join(', ')}. Ensure each line is in the format "email,password".`);
  }

  // If validation passes, write the file and redirect
  fs.writeFile(filePath, content, 'utf8', err => {
    if (err) {
      return res.status(500).send('Failed to save file');
    }

    res.redirect('/dhakamirpurdhaka'); // Redirect to the home page after saving
  });
});


// Route to delete a CSV file
app.get('/remove/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(csvDirectory, filename);

  fs.unlink(filePath, err => {
    if (err) {
      return res.status(500).send('Failed to delete file');
    }
    res.redirect('/'); // Redirect back to the list after deletion
  });
});
// Route to list all CSV files in the folder
app.get('/file', (req, res) => {
  const folderPath = './'; // Specify the folder path where the CSV files are located

  fs.readdir(folderPath, (err, files) => {
    if (err) {
      console.error(`Error reading directory: ${err.message}`);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    // Filter out CSV files
    const user_name_with_csv_file = files.filter(file => file.endsWith('.csv'));

    if (user_name_with_csv_file.length === 0) {
      console.log('No CSV files found in the directory.');
      return res.status(404).json({ message: 'No CSV files found.' });
    }

    console.log(`user base files found: ${user_name_with_csv_file.join(', ')}`);
    return res.status(200).json({ user_name_with_csv_file });
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
