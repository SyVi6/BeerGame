FROM eclipse-temurin:21-jdk

WORKDIR /app

# Install Maven inside the image
RUN apt-get update && apt-get install -y maven && rm -rf /var/lib/apt/lists/*

# Cache dependencies
COPY pom.xml .
RUN mvn -q -DskipTests dependency:go-offline

# Build the app
COPY src ./src
RUN mvn -q -DskipTests package

EXPOSE 8080
CMD ["sh","-c","java -jar target/*.jar"]