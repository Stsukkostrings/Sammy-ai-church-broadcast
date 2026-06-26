# Code Citations

## License: unknown
https://github.com/appotry/hexo/blob/b3f3f8210e71eead8dbbafa1ccb393d425ad4182/posts/5311b619/index.html

```
## **THE ISSUE** 🔴

Your `vercel.json` **doesn't configure routing for your API endpoints**, so Vercel doesn't know how to handle requests to `/api/youtube-channel` etc. It's looking for a file at that exact path and returns 404 when it can't find it.

---

## **1. THE FIX**

Update your `vercel.json` to add rewrites that route API requests to your serverless functions:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*.js"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source":
```


## License: unknown
https://github.com/appotry/hexo/blob/b3f3f8210e71eead8dbbafa1ccb393d425ad4182/posts/5311b619/index.html

```
## **THE ISSUE** 🔴

Your `vercel.json` **doesn't configure routing for your API endpoints**, so Vercel doesn't know how to handle requests to `/api/youtube-channel` etc. It's looking for a file at that exact path and returns 404 when it can't find it.

---

## **1. THE FIX**

Update your `vercel.json` to add rewrites that route API requests to your serverless functions:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*.js"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source":
```


## License: unknown
https://github.com/appotry/hexo/blob/b3f3f8210e71eead8dbbafa1ccb393d425ad4182/posts/5311b619/index.html

```
## **THE ISSUE** 🔴

Your `vercel.json` **doesn't configure routing for your API endpoints**, so Vercel doesn't know how to handle requests to `/api/youtube-channel` etc. It's looking for a file at that exact path and returns 404 when it can't find it.

---

## **1. THE FIX**

Update your `vercel.json` to add rewrites that route API requests to your serverless functions:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*.js"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source":
```


## License: unknown
https://github.com/appotry/hexo/blob/b3f3f8210e71eead8dbbafa1ccb393d425ad4182/posts/5311b619/index.html

```
## **THE ISSUE** 🔴

Your `vercel.json` **doesn't configure routing for your API endpoints**, so Vercel doesn't know how to handle requests to `/api/youtube-channel` etc. It's looking for a file at that exact path and returns 404 when it can't find it.

---

## **1. THE FIX**

Update your `vercel.json` to add rewrites that route API requests to your serverless functions:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*.js"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source":
```


## License: unknown
https://github.com/appotry/hexo/blob/b3f3f8210e71eead8dbbafa1ccb393d425ad4182/posts/5311b619/index.html

```
## **THE ISSUE** 🔴

Your `vercel.json` **doesn't configure routing for your API endpoints**, so Vercel doesn't know how to handle requests to `/api/youtube-channel` etc. It's looking for a file at that exact path and returns 404 when it can't find it.

---

## **1. THE FIX**

Update your `vercel.json` to add rewrites that route API requests to your serverless functions:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*.js"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source":
```


## License: unknown
https://github.com/appotry/hexo/blob/b3f3f8210e71eead8dbbafa1ccb393d425ad4182/posts/5311b619/index.html

```
## **THE ISSUE** 🔴

Your `vercel.json` **doesn't configure routing for your API endpoints**, so Vercel doesn't know how to handle requests to `/api/youtube-channel` etc. It's looking for a file at that exact path and returns 404 when it can't find it.

---

## **1. THE FIX**

Update your `vercel.json` to add rewrites that route API requests to your serverless functions:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*.js"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source":
```


## License: unknown
https://github.com/appotry/hexo/blob/b3f3f8210e71eead8dbbafa1ccb393d425ad4182/posts/5311b619/index.html

```
## **THE ISSUE** 🔴

Your `vercel.json` **doesn't configure routing for your API endpoints**, so Vercel doesn't know how to handle requests to `/api/youtube-channel` etc. It's looking for a file at that exact path and returns 404 when it can't find it.

---

## **1. THE FIX**

Update your `vercel.json` to add rewrites that route API requests to your serverless functions:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*.js"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source":
```


## License: unknown
https://github.com/appotry/hexo/blob/b3f3f8210e71eead8dbbafa1ccb393d425ad4182/posts/5311b619/index.html

```
## **THE ISSUE** 🔴

Your `vercel.json` **doesn't configure routing for your API endpoints**, so Vercel doesn't know how to handle requests to `/api/youtube-channel` etc. It's looking for a file at that exact path and returns 404 when it can't find it.

---

## **1. THE FIX**

Update your `vercel.json` to add rewrites that route API requests to your serverless functions:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*.js"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source":
```


## License: unknown
https://github.com/appotry/hexo/blob/b3f3f8210e71eead8dbbafa1ccb393d425ad4182/posts/5311b619/index.html

```
## **THE ISSUE** 🔴

Your `vercel.json` **doesn't configure routing for your API endpoints**, so Vercel doesn't know how to handle requests to `/api/youtube-channel` etc. It's looking for a file at that exact path and returns 404 when it can't find it.

---

## **1. THE FIX**

Update your `vercel.json` to add rewrites that route API requests to your serverless functions:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*.js"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source":
```

