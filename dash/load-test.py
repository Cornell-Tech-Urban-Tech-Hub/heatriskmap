from locust import HttpUser, task, between
from bs4 import BeautifulSoup

class WebsiteUser(HttpUser):
    wait_time = between(1, 5)  # Wait 1-5 seconds between tasks

    def on_start(self):
        # This method is called when a user starts
        self.client.get("/")  # Load the homepage first

    @task
    def load_homepage(self):
        response = self.client.get("/")
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            self.load_static_resources(soup)

    def load_static_resources(self, soup):
        # Load CSS files
        for css in soup.find_all('link', rel='stylesheet'):
            self.client.get(css['href'])

        # Load JavaScript files
        for script in soup.find_all('script', src=True):
            self.client.get(script['src'])

        # Load images
        for img in soup.find_all('img', src=True):
            self.client.get(img['src'])

    # @task
    # def load_random_page(self):
    #     # Add more specific pages here
    #     self.client.get("/some-page")

    # @task
    # def perform_search(self):
    #     # Simulate a search action
    #     self.client.get("/search?q=test")