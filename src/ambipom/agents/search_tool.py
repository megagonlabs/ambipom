import os

import requests
from bs4 import BeautifulSoup


class WebSearchTool:
    def __init__(
        self,
        api_key: str = None,
        num_results: int = 3,
    ):
        self.api_key = api_key
        self.config = {
            "num_results": num_results,
        }

    def _fetch_link_content(self, url: str) -> dict:
        """
        Fetches the full content of a web page given its URL. Limited to the first 5000 characters.

        Args:
            url: The URL to fetch content from

        Returns:
            Dictionary containing content, metadata, and any errors
        """
        max_chars = 5000
        timeout = 10

        result = {
            "url": url,
            "success": False,
            "content": "",
            "title": "",
            "error": None,
            "status_code": None,
            "content_type": None,
        }

        try:
            # Add headers to appear more like a regular browser
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate",
                "Connection": "keep-alive",
            }

            response = requests.get(url, headers=headers, timeout=timeout)
            result["status_code"] = response.status_code
            result["content_type"] = response.headers.get("content-type", "")

            response.raise_for_status()

            # Check if it's HTML content
            if "text/html" in result["content_type"].lower():
                soup = BeautifulSoup(response.content, "html.parser")

                # Extract title
                title_tag = soup.find("title")
                if title_tag:
                    result["title"] = title_tag.get_text().strip()

                # Remove script and style elements
                for script in soup(["script", "style", "nav", "header", "footer"]):
                    script.decompose()

                # Try to find main content areas first
                main_content = None
                content_selectors = [
                    "main",
                    "article",
                    '[role="main"]',
                    ".content",
                    ".main-content",
                    ".article-content",
                    ".post-content",
                    ".entry-content",
                ]

                for selector in content_selectors:
                    main_content = soup.select_one(selector)
                    if main_content:
                        break

                # If no main content found, use body
                if not main_content:
                    main_content = soup.find("body") or soup

                # Extract text
                text = main_content.get_text()

                # Clean up the text
                lines = (line.strip() for line in text.splitlines())
                chunks = (
                    phrase.strip() for line in lines for phrase in line.split("  ")
                )
                text = " ".join(chunk for chunk in chunks if chunk)

                result["content"] = text[:max_chars]
                if len(text) > max_chars:
                    result["content"] += "... [Content truncated]"

            else:
                # For non-HTML content, return raw text (up to max_chars)
                result["content"] = response.text[:max_chars]
                if len(response.text) > max_chars:
                    result["content"] += "... [Content truncated]"

            result["success"] = True

        except requests.exceptions.Timeout:
            result["error"] = f"Request timed out after {timeout} seconds"
        except requests.exceptions.ConnectionError:
            result["error"] = "Failed to connect to the URL"
        except requests.exceptions.HTTPError as e:
            result["error"] = f"HTTP error: {e}"
        except requests.exceptions.RequestException as e:
            result["error"] = f"Request error: {e}"
        except Exception as e:
            result["error"] = f"Unexpected error: {e}"

        return result

    def execute(self, search_query: str) -> (str, dict, dict):
        """
        Executes the web search using Brave Search API and processes the results.
        Returns a tuple: (search_results_str, dict_display_results, raw_results)
        """
        brave_api_key = os.environ.get("BRAVE_API_KEY") or self.api_key
        brave_search_url = os.getenv(
            "BRAVE_SEARCH_URL", "https://api.search.brave.com/res/v1/web/search"
        )
        config = self.config.copy()

        if not brave_api_key:
            raise ValueError(
                "Missing Brave API key. Set BRAVE_API_KEY env var or pass via api_key."
            )

        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": brave_api_key,
        }

        params = {
            "q": search_query,
            "count": config["num_results"],
        }

        try:
            resp = requests.get(
                brave_search_url, headers=headers, params=params, timeout=30.0
            )
            resp.raise_for_status()
            json_resp = resp.json()
        except Exception as e:
            err_msg = f"Error calling Brave Search API: {e}"
            return err_msg, {}, {"error": err_msg}

        # try to locate the list of result items in known keys
        raw_results = None
        for key in ("results", "items", "data", "organicResults", "organic"):
            if key in json_resp and isinstance(json_resp[key], list):
                raw_results = json_resp[key]
                break

        # Handle Brave's nested web.results structure
        if raw_results is None and "web" in json_resp:
            web = json_resp["web"]
            if isinstance(web, dict) and isinstance(web.get("results"), list):
                raw_results = web["results"]
            elif isinstance(web, list):
                raw_results = web

        if raw_results is None:
            if isinstance(json_resp, list):
                raw_results = json_resp
            else:
                return "No result items found in Brave response.", {}, json_resp

        search_results_str = ""
        dict_display_results = {}

        for item in raw_results:
            # tolerant extraction for common field names
            title = item.get("title") or item.get("name") or item.get("headline") or ""
            link = (
                item.get("url")
                or item.get("link")
                or item.get("uri")
                or item.get("target")
            )
            snippet = (
                item.get("snippet")
                or item.get("summary")
                or item.get("excerpt")
                or item.get("description")
                or ""
            )

            display_title = title or (link if link else "Untitled result")
            dict_display_results[display_title] = f"Snippet:{snippet}\n"

            fetch_result = {"content": "", "error": "no link provided"}
            if link:
                fetch_result = self._fetch_link_content(link)
                dict_display_results[display_title] += (
                    f"Content:{fetch_result.get('content', '')}\n"
                )
            else:
                dict_display_results[display_title] += "Content: (no link to fetch)\n"

            search_results_str += (
                f"Title: {display_title}\n"
                f"Snippet: {snippet}\n"
                f"Content: {fetch_result.get('content', '')}\n\n"
            )

        return search_results_str, dict_display_results, raw_results
